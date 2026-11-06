import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { nativeRuntimeManifest } from "./profile";
import { runNativeProcess } from "./sandbox";
import { type NativeClientConfig, NativeError, type NativeRuntimeIdentity } from "./types";

export interface PreparedNativeRuntime {
  identity: NativeRuntimeIdentity;
  executable: string;
  modelDirectory: string;
  bubblewrapPath: string;
}

// Snapshot trusted bundled data, never a caller's replacement or mutable alias.
const reviewed = structuredClone(nativeRuntimeManifest);
const manifestSha256 = createHash("sha256").update(JSON.stringify(reviewed)).digest("hex");
const VERSION = "docling-rs 2.53.1 (chunking, mcp); ONNX Runtime 1.31";

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new NativeError("ABORTED", "Native verification aborted");
}

function installationPath(path: string): string {
  if (typeof path !== "string" || !path || path.includes("\0") || path.split("/").includes("..")) {
    throw new NativeError("INVALID_CONFIGURATION", "Invalid native installation path");
  }
  return resolve(path);
}

/** Inspect every component: a regular leaf behind a symlink is still rejected. */
async function inspectPath(path: string, signal?: AbortSignal) {
  let current = "/";
  const components = path.split("/").filter(Boolean);
  for (const [index, component] of components.entries()) {
    checkAbort(signal);
    current = join(current, component);
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || (index < components.length - 1 && !entry.isDirectory())) {
      throw new NativeError(
        "RUNTIME_INTEGRITY",
        "Native installation contains a link or special file"
      );
    }
  }
  checkAbort(signal);
  return lstat(path);
}

async function verifyFile(
  path: string,
  expected: { size: number; sha256: string },
  signal?: AbortSignal
): Promise<void> {
  const entry = await inspectPath(path, signal);
  if (!entry.isFile() || entry.size !== expected.size) {
    throw new NativeError(
      "RUNTIME_INTEGRITY",
      "Native file type or size does not match the profile"
    );
  }
  // O_NONBLOCK avoids blocking on a raced FIFO; O_NOFOLLOW rejects a raced leaf
  // symlink. fstat ties byte verification to the opened regular file.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.size !== expected.size ||
      before.ino !== entry.ino ||
      before.dev !== entry.dev
    ) {
      throw new NativeError("RUNTIME_INTEGRITY", "Native file changed during verification");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size = 0;
    while (true) {
      checkAbort(signal);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      checkAbort(signal);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > expected.size)
        throw new NativeError("RUNTIME_INTEGRITY", "Native file grew during verification");
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat();
    if (
      size !== expected.size ||
      hash.digest("hex") !== expected.sha256 ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new NativeError("RUNTIME_INTEGRITY", "Native file SHA256 does not match the profile");
    }
  } finally {
    await file.close();
  }
}

async function verifyModels(directory: string, signal?: AbortSignal): Promise<void> {
  if (!(await inspectPath(directory, signal)).isDirectory()) {
    throw new NativeError("RUNTIME_INTEGRITY", "Native models must be a real directory");
  }
  const files = new Map(reviewed.assets.map((asset) => [asset.path, asset]));
  const directories = new Set<string>();
  for (const path of files.keys()) {
    const parts = path.split("/");
    if (
      isAbsolute(path) ||
      path.includes("\\") ||
      path.includes("\0") ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new NativeError("RUNTIME_INTEGRITY", "Bundled profile contains an invalid asset path");
    }
    for (let index = 1; index < parts.length; index++)
      directories.add(parts.slice(0, index).join("/"));
  }
  const found = new Set<string>();
  async function visit(relative: string): Promise<void> {
    checkAbort(signal);
    for (const name of await readdir(join(directory, relative))) {
      checkAbort(signal);
      const path = relative ? `${relative}/${name}` : name;
      const entry = await lstat(join(directory, path));
      if (entry.isSymbolicLink())
        throw new NativeError("RUNTIME_INTEGRITY", "Native model links are forbidden");
      if (entry.isDirectory() && directories.has(path)) {
        await visit(path);
      } else if (entry.isFile() && files.has(path)) {
        found.add(path);
      } else {
        throw new NativeError(
          "RUNTIME_INTEGRITY",
          "Native model directory contains an unreviewed file"
        );
      }
    }
  }
  await visit("");
  for (const asset of reviewed.assets) {
    if (!found.has(asset.path))
      throw new NativeError("RUNTIME_UNAVAILABLE", `Missing native asset: ${asset.path}`);
    await verifyFile(join(directory, asset.path), asset, signal);
  }
}

export async function verifyNativeRuntime(
  config: NativeClientConfig,
  signal?: AbortSignal
): Promise<PreparedNativeRuntime> {
  checkAbort(signal);
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new NativeError("UNSUPPORTED_PLATFORM", "Native runtime requires Linux x64");
  }
  if (config.manifest !== undefined && !isDeepStrictEqual(config.manifest, reviewed)) {
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "Native manifest must match the bundled reviewed profile"
    );
  }
  const executable = installationPath(config.executable);
  const modelDirectory = installationPath(config.modelDirectory);
  const bubblewrapPath = config.bubblewrapPath ?? "/usr/bin/bwrap";
  if (typeof bubblewrapPath !== "string" || !isAbsolute(bubblewrapPath)) {
    throw new NativeError("INVALID_CONFIGURATION", "Bubblewrap path must be absolute");
  }
  installationPath(bubblewrapPath);
  try {
    await verifyFile(executable, reviewed.executable, signal);
    await access(executable, constants.X_OK);
    await verifyModels(modelDirectory, signal);
  } catch (error) {
    checkAbort(signal);
    if (error instanceof NativeError) throw error;
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new NativeError(
      missing ? "RUNTIME_UNAVAILABLE" : "RUNTIME_INTEGRITY",
      "Unable to verify native installation",
      { cause: error }
    );
  }
  try {
    if (!(await inspectPath(bubblewrapPath, signal)).isFile())
      throw new Error("Not a regular executable");
    await access(bubblewrapPath, constants.X_OK);
  } catch (error) {
    checkAbort(signal);
    throw new NativeError("ISOLATION_UNAVAILABLE", "Bubblewrap is unavailable", { cause: error });
  }
  const runtime: PreparedNativeRuntime = {
    executable,
    modelDirectory,
    bubblewrapPath,
    identity: {
      profile: reviewed.id,
      engine: "docling-rs",
      version: reviewed.engine.version,
      commit: reviewed.engine.commit,
      platform: "linux-x64",
      executableSha256: reviewed.executable.sha256,
      manifestSha256,
      isolation: "bubblewrap",
    },
  };
  checkAbort(signal);
  const workDirectory = await mkdtemp(join(tmpdir(), "docling-native-readiness-"));
  try {
    // The same sandbox as conversion must create its private PID-scoped procfs.
    // A kernel mount denial propagates as ISOLATION_UNAVAILABLE before readiness.
    const result = await runNativeProcess(runtime, workDirectory, ["--version"], {
      signal,
      timeoutMs: 10000,
    });
    checkAbort(signal);
    if (!result.success || result.exitCode !== 0 || result.signal !== null) {
      throw new NativeError("RUNTIME_UNAVAILABLE", "Isolated native readiness check failed");
    }
    if (
      (result.stdout !== VERSION && result.stdout !== `${VERSION}\n`) ||
      result.stderr.trim() !== ""
    ) {
      throw new NativeError(
        "RUNTIME_INTEGRITY",
        "Native version does not match the reviewed runtime"
      );
    }
    return runtime;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
