import { chmod, lstat, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ProcessAbortError, ProcessTimeoutError } from "../cli/process-runner";
import { snapshotNativeInput } from "./input";
import { NATIVE_LIMITS } from "./limits";
import { inspectNativeOutputs } from "./output";
import { verifyNativeRuntime } from "./runtime";
import { runNativeProcess } from "./sandbox";
import { NativeError } from "./types";
import type {
  NativeClientConfig,
  NativeConversionResult,
  NativeConvertOptions,
  NativeFormat,
  NativeRuntimeIdentity,
} from "./types";

export interface NativeClient {
  checkRuntime(options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<NativeRuntimeIdentity>;
  convertFile(input: string, options: NativeConvertOptions): Promise<NativeConversionResult>;
}

const OPTION_KEYS = new Set([
  "outputDirectory",
  "formats",
  "signal",
  "timeoutMs",
  "pageRange",
  "documentTimeoutSeconds",
]);
const CONFIG_KEYS = new Set(["executable", "modelDirectory", "manifest", "bubblewrapPath"]);

function timeoutValue(value: number | undefined): number {
  const timeout = value ?? NATIVE_LIMITS.defaultTimeoutMs;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > NATIVE_LIMITS.maxTimeoutMs) {
    throw new NativeError(
      "INVALID_CONFIGURATION",
      `timeoutMs must be between 1 and ${NATIVE_LIMITS.maxTimeoutMs}`
    );
  }
  return timeout;
}

async function withDeadline<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal, remaining: () => number) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const expires = Date.now() + timeoutMs;
  const onAbort = () => controller.abort();
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    controller.signal.throwIfAborted();
    const result = await operation(controller.signal, () => Math.max(1, expires - Date.now()));
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (timedOut || error instanceof ProcessTimeoutError) {
      throw new NativeError("TIMEOUT", `Native conversion deadline exceeded (${timeoutMs} ms)`, {
        cause: error,
      });
    }
    if (controller.signal.aborted || error instanceof ProcessAbortError) {
      throw new NativeError("ABORTED", "Native operation aborted", { cause: error });
    }
    if (error instanceof NativeError) throw error;
    throw new NativeError("EXECUTION_FAILED", "Native operation failed", { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function snapshotConfig(config: NativeClientConfig): NativeClientConfig {
  if (
    !config ||
    typeof config !== "object" ||
    Object.keys(config).some((key) => !CONFIG_KEYS.has(key))
  ) {
    throw new NativeError("INVALID_CONFIGURATION", "Unsupported native client configuration");
  }
  for (const key of ["executable", "modelDirectory"] as const) {
    const value = config[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.includes("\0") ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ) {
      throw new NativeError("INVALID_CONFIGURATION", `${key} must be a local filesystem path`);
    }
  }
  if (
    config.bubblewrapPath !== undefined &&
    (typeof config.bubblewrapPath !== "string" ||
      !isAbsolute(config.bubblewrapPath) ||
      config.bubblewrapPath.includes("\0"))
  ) {
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "bubblewrapPath must be an absolute filesystem path"
    );
  }
  try {
    return Object.freeze({
      executable: resolve(config.executable),
      modelDirectory: resolve(config.modelDirectory),
      ...(config.manifest !== undefined && { manifest: structuredClone(config.manifest) }),
      ...(config.bubblewrapPath !== undefined && { bubblewrapPath: config.bubblewrapPath }),
    });
  } catch (error) {
    throw new NativeError("INVALID_CONFIGURATION", "Invalid native runtime manifest", {
      cause: error,
    });
  }
}

function snapshotOptions(options: NativeConvertOptions) {
  if (
    !options ||
    typeof options !== "object" ||
    Object.keys(options).some((key) => !OPTION_KEYS.has(key))
  ) {
    throw new NativeError("INVALID_CONFIGURATION", "Unsupported native conversion options");
  }
  if (
    typeof options.outputDirectory !== "string" ||
    !options.outputDirectory.trim() ||
    options.outputDirectory.includes("\0") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(options.outputDirectory)
  ) {
    throw new NativeError("INVALID_CONFIGURATION", "outputDirectory must be a local directory");
  }
  const formats = options.formats ?? ["md", "json"];
  if (
    !Array.isArray(formats) ||
    formats.length < 1 ||
    formats.length > 2 ||
    formats.some((format) => format !== "md" && format !== "json") ||
    new Set(formats).size !== formats.length
  ) {
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "formats must contain distinct md and/or json values"
    );
  }
  const pageRange = options.pageRange;
  if (
    pageRange !== undefined &&
    (!Array.isArray(pageRange) ||
      pageRange.length !== 2 ||
      pageRange.some(
        (page) => !Number.isSafeInteger(page) || page < 1 || page > NATIVE_LIMITS.maxPages
      ) ||
      pageRange[0] > pageRange[1])
  ) {
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "pageRange must be an inclusive positive PDF page range"
    );
  }
  const documentTimeoutSeconds = options.documentTimeoutSeconds;
  if (
    documentTimeoutSeconds !== undefined &&
    (!Number.isFinite(documentTimeoutSeconds) ||
      documentTimeoutSeconds <= 0 ||
      documentTimeoutSeconds > NATIVE_LIMITS.maxTimeoutMs / 1000)
  ) {
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "documentTimeoutSeconds must be positive and at most 900"
    );
  }
  return {
    outputDirectory: resolve(options.outputDirectory),
    formats: [...formats] as NativeFormat[],
    timeoutMs: timeoutValue(options.timeoutMs),
    signal: options.signal,
    pageRange: pageRange === undefined ? undefined : ([pageRange[0], pageRange[1]] as const),
    documentTimeoutSeconds,
  };
}

/** Creates an explicit local-only Rust client; it never installs components or falls back. */
export function createNativeClient(configuration: NativeClientConfig): NativeClient {
  const config = snapshotConfig(configuration);
  return {
    async checkRuntime(options = {}) {
      return withDeadline(
        options.signal,
        timeoutValue(options.timeoutMs),
        async (signal) => (await verifyNativeRuntime(config, signal)).identity
      );
    },
    async convertFile(input, options) {
      const request = snapshotOptions(options);
      return withDeadline(request.signal, request.timeoutMs, async (signal, remaining) => {
        let staging: string | undefined;
        let destination: string | undefined;
        let published = false;
        try {
          signal.throwIfAborted();
          await mkdir(request.outputDirectory, { recursive: true, mode: 0o700 });
          const directoryStat = await lstat(request.outputDirectory);
          if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
            throw new NativeError(
              "INVALID_CONFIGURATION",
              "outputDirectory must be a real directory, not a symlink"
            );
          }
          const root = await realpath(request.outputDirectory);
          staging = await mkdtemp(join(root, ".docling-native-stage-"));
          await chmod(staging, 0o700);
          for (const directory of ["input", "output", "home"]) {
            await mkdir(join(staging, directory), { mode: 0o700 });
          }
          const snapshot = await snapshotNativeInput(input, join(staging, "input"), signal);
          if (
            snapshot.format !== "pdf" &&
            (request.pageRange || request.documentTimeoutSeconds !== undefined)
          ) {
            throw new NativeError(
              "INVALID_CONFIGURATION",
              "Page ranges and document budgets are supported only for PDF inputs"
            );
          }
          const runtime = await verifyNativeRuntime(config, signal);
          signal.throwIfAborted();
          const args = [
            "--from",
            snapshot.format,
            "--pipeline",
            "standard",
            "--ocr-engine",
            "ppocr",
            "--no-url-fetch",
            "--image-sources",
            "none",
            "--no-progress",
            "--no-stream",
            "--strict",
            "--layers",
            "body,notes",
            "--output-dirs",
            "flat",
            "--jobs",
            "1",
            "--to",
            "md",
            "--to",
            "json",
            "--images",
            "referenced",
            ...(request.pageRange ? ["--pages", request.pageRange.join("-")] : []),
            ...(request.documentTimeoutSeconds === undefined
              ? []
              : ["--document-timeout", String(request.documentTimeoutSeconds)]),
            "--output",
            "/work/output",
            `/work/input/source.${snapshot.format}`,
          ];
          const processResult = await runNativeProcess(runtime, staging, args, {
            signal,
            timeoutMs: remaining(),
          });
          signal.throwIfAborted();
          const inspected = await inspectNativeOutputs(
            join(staging, "output"),
            snapshot,
            request.formats,
            processResult,
            request.pageRange
          );
          signal.throwIfAborted();
          const result: NativeConversionResult = {
            ...inspected,
            input: {
              filename: snapshot.filename,
              format: snapshot.format,
              size: snapshot.size,
              sha256: snapshot.sha256,
            },
            runtime: runtime.identity,
          };
          if (result.status === "failure" || result.files.length === 0)
            return { ...result, files: [] };
          // Publish exactly the validated receipt, never malformed or unrequested
          // artifacts that happened to be written by the converter.
          const publishDirectory = join(staging, "publish");
          await mkdir(publishDirectory, { mode: 0o700 });
          for (const file of result.files) {
            signal.throwIfAborted();
            const target = join(publishDirectory, file.path);
            await mkdir(dirname(target), { recursive: true, mode: 0o700 });
            await rename(join(staging, "output", file.path), target);
          }
          destination = await mkdtemp(join(root, "docling-native-"));
          await chmod(destination, 0o700);
          const outputDirectory = join(destination, "files");
          // The reserved private parent means this destination cannot collide with caller files.
          await rename(publishDirectory, outputDirectory);
          signal.throwIfAborted();
          await rm(staging, { recursive: true, force: true });
          staging = undefined;
          signal.throwIfAborted();
          published = true;
          return { ...result, outputDirectory };
        } finally {
          if (staging) await rm(staging, { recursive: true, force: true });
          if (destination && !published) await rm(destination, { recursive: true, force: true });
        }
      });
    },
  };
}
