import { lstat, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  ProcessAbortError,
  type ProcessRunResult,
  ProcessTimeoutError,
  runProcess,
} from "../cli/process-runner";
import { NATIVE_LIMITS } from "./limits";
import type { PreparedNativeRuntime } from "./runtime";
import { NativeError } from "./types";

/** Every path here is a sandbox path, independent of the installation location. */
const environment = Object.freeze({
  HOME: "/tmp",
  TMPDIR: "/tmp",
  XDG_CACHE_HOME: "/tmp/cache",
  XDG_CONFIG_HOME: "/tmp/config",
  LANG: "C.UTF-8",
  DOCLING_RS_MODELS_DIR: "/models",
  DOCLING_LAYOUT_ONNX: "/models/layout_heron.onnx",
  DOCLING_OCR_REC_ONNX: "/models/ocr_rec_v6.onnx",
  DOCLING_OCR_DICT: "/models/ocr_rec_v6_dict.txt",
  DOCLING_OCR_DET_ONNX: "/models/ocr_det.onnx",
  DOCLING_TABLEFORMER_ENCODER: "/models/tableformer/encoder_fp16.onnx",
  DOCLING_TABLEFORMER_DECODER: "/models/tableformer/decoder_kv_layers.onnx",
  DOCLING_TABLEFORMER_BBOX: "/models/tableformer/bbox.onnx",
  DOCLING_RS_SYSTEM_FONTS: "0",
  DOCLING_RS_EP: "cpu",
  DOCLING_RS_PDF_THREADS: "2",
  DOCLING_RS_PDF_WORKERS: "1",
  DOCLING_RS_OCR_SESSIONS: "1",
  RAYON_NUM_THREADS: "2",
  OMP_NUM_THREADS: "2",
  OPENBLAS_NUM_THREADS: "2",
});

export async function runNativeProcess(
  runtime: PreparedNativeRuntime,
  workDirectory: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs: number }
): Promise<ProcessRunResult> {
  if (options.signal?.aborted) throw new NativeError("ABORTED", "Native execution aborted");
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new NativeError("UNSUPPORTED_PLATFORM", "Native runtime requires Linux x64");
  }
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > NATIVE_LIMITS.maxTimeoutMs
  ) {
    throw new NativeError("INVALID_CONFIGURATION", "Native timeout is outside the supported range");
  }
  for (const path of [
    runtime.bubblewrapPath,
    runtime.executable,
    runtime.modelDirectory,
    workDirectory,
  ]) {
    if (!isAbsolute(path) || path.includes("\0") || path.split("/").includes("..")) {
      throw new NativeError("INVALID_CONFIGURATION", "Native sandbox paths must be absolute");
    }
  }

  const sandboxArgs = ["--unshare-all", "--die-with-parent", "--cap-drop", "ALL", "--clearenv"];
  // These are the only host OS directories exposed. In particular there is no
  // host /proc, /etc, home, host temporary directory, or entire /usr mount.
  for (const directory of ["/usr/lib", "/usr/lib64", "/lib", "/lib64"]) {
    try {
      if (!(await stat(directory)).isDirectory()) continue;
      sandboxArgs.push("--ro-bind", directory, directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // ONNX Runtime resolves opened model files through /proc/self/fd. Mount a
  // fresh procfs for the PID namespace created by --unshare-all, never host /proc.
  // If the kernel forbids this mount, bwrap must fail before executing the engine.
  sandboxArgs.push(
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/runtime",
    "--ro-bind",
    runtime.executable,
    "/runtime/docling-rs",
    "--ro-bind",
    runtime.modelDirectory,
    "/models",
    "--bind",
    resolve(workDirectory),
    "/work",
    "--chdir",
    "/work"
  );
  for (const [name, value] of Object.entries(environment)) {
    sandboxArgs.push("--setenv", name, value);
  }
  try {
    const fonts = await lstat(`${runtime.modelDirectory}/fonts`);
    if (!fonts.isDirectory() || fonts.isSymbolicLink()) {
      throw new NativeError("RUNTIME_INTEGRITY", "Native font directory must be a real directory");
    }
    sandboxArgs.push("--setenv", "DOCLING_RS_FONT_DIRS", "/models/fonts");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  sandboxArgs.push("--", "/runtime/docling-rs", ...args);
  let result: ProcessRunResult;
  try {
    // No inherited environment even for the host-side sandbox launcher. runProcess
    // owns pipes and the detached process group; bwrap owns the PID namespace.
    result = await runProcess(runtime.bubblewrapPath, sandboxArgs, {
      cwd: workDirectory,
      env: {},
      timeout: options.timeoutMs,
      signal: options.signal,
      maxBuffer: NATIVE_LIMITS.diagnosticBytes,
    });
  } catch (error) {
    if (error instanceof ProcessAbortError || options.signal?.aborted) {
      throw new NativeError("ABORTED", "Native execution aborted", { cause: error });
    }
    if (error instanceof ProcessTimeoutError) {
      throw new NativeError("TIMEOUT", "Native execution timed out", { cause: error });
    }
    throw new NativeError("ISOLATION_UNAVAILABLE", "Unable to run the native sandbox", {
      cause: error,
    });
  }
  // runProcess resolves ordinary nonzero exits. Recognizable launcher diagnostics
  // identify setup failures; engine failures keep their original result.
  if (result.exitCode !== null && result.exitCode !== 0 && /^bwrap: /m.test(result.stderr)) {
    throw new NativeError(
      "ISOLATION_UNAVAILABLE",
      "Bubblewrap startup failed; private namespaces and procfs are required",
      { cause: result }
    );
  }
  return result;
}
