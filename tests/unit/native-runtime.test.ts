import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessAbortError, ProcessTimeoutError, runProcess } from "../../src/cli/process-runner";
import { nativeRuntimeManifest } from "../../src/native/profile";
import { verifyNativeRuntime } from "../../src/native/runtime";
import type { NativeClientConfig } from "../../src/native/types";

vi.mock("../../src/cli/process-runner", async (original) => ({
  ...(await original<typeof import("../../src/cli/process-runner")>()),
  runProcess: vi.fn(),
}));

// Replace only the bundled trust root with small byte fixtures. Caller-provided
// manifests still pass through the real public verifier and must equal this root.
vi.mock("../../src/native/profile", async (original) => {
  const { nativeRuntimeManifest: profile } =
    await original<typeof import("../../src/native/profile")>();
  const { createHash: hash } = await import("node:crypto");
  const pin = (path: string) => ({
    size: Buffer.byteLength(`fixture:${path}`),
    sha256: hash("sha256").update(`fixture:${path}`).digest("hex"),
  });
  return {
    nativeRuntimeManifest: {
      ...profile,
      executable: { ...profile.executable, ...pin(profile.executable.path) },
      assets: profile.assets.map((asset) => ({ ...asset, ...pin(asset.path) })),
    },
  };
});

const runner = vi.mocked(runProcess);
const version = "docling-rs 2.53.1 (chunking, mcp); ONNX Runtime 1.31\n";
const success = { stdout: version, stderr: "", success: true, exitCode: 0, signal: null } as const;
let directory: string;
let config: NativeClientConfig;

beforeEach(async () => {
  runner.mockReset().mockResolvedValue(success);
  directory = await mkdtemp(join(tmpdir(), "native-runtime-test-"));
  config = {
    executable: join(directory, "docling-rs"),
    modelDirectory: join(directory, "models"),
    bubblewrapPath: join(directory, "bwrap"),
  };
  await writeFile(config.executable, `fixture:${nativeRuntimeManifest.executable.path}`, {
    mode: 0o700,
  });
  await writeFile(required(config.bubblewrapPath), "fixture-bwrap", { mode: 0o700 });
  for (const asset of nativeRuntimeManifest.assets) {
    const path = join(config.modelDirectory, asset.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `fixture:${asset.path}`);
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("verifyNativeRuntime public boundary", () => {
  it("verifies every asset and executes isolated readiness in a removed private directory", async () => {
    config.manifest = structuredClone(nativeRuntimeManifest);
    const runtime = await verifyNativeRuntime(config);
    expect(runtime).toMatchObject({
      executable: config.executable,
      modelDirectory: config.modelDirectory,
      bubblewrapPath: config.bubblewrapPath,
      identity: {
        profile: nativeRuntimeManifest.id,
        version: "2.53.1",
        isolation: "bubblewrap",
        executableSha256: nativeRuntimeManifest.executable.sha256,
        manifestSha256: createHash("sha256")
          .update(JSON.stringify(nativeRuntimeManifest))
          .digest("hex"),
      },
    });
    const [executable, args, options] = required(runner.mock.calls[0]);
    expect(executable).toBe(config.bubblewrapPath);
    expect(args.slice(-3)).toEqual(["--", "/runtime/docling-rs", "--version"]);
    expect(args).toContain("--unshare-all");
    expect(args.slice(args.indexOf("--proc"), args.indexOf("--proc") + 2)).toEqual([
      "--proc",
      "/proc",
    ]);
    expect(options?.env).toEqual({});
    expect(options?.timeout).toBe(10000);
    expect(options?.cwd).not.toBe(config.modelDirectory);
    await expect(access(required(options?.cwd))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["platform", "arch"] as const)(
    "rejects unsupported %s before executing anything",
    async (property) => {
      const descriptor = required(Object.getOwnPropertyDescriptor(process, property));
      Object.defineProperty(process, property, {
        value: property === "platform" ? "darwin" : "arm64",
        configurable: true,
      });
      try {
        await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
          code: "UNSUPPORTED_PLATFORM",
        });
        expect(runner).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, property, descriptor);
      }
    }
  );

  it.each(["hash", "version", "commit", "extra asset", "traversal"])(
    "rejects a caller-chosen manifest: %s",
    async (change) => {
      const manifest = structuredClone(nativeRuntimeManifest);
      config.manifest = {
        ...manifest,
        ...(change === "hash"
          ? { executable: { ...manifest.executable, sha256: "a".repeat(64) } }
          : {}),
        ...(change === "version" ? { engine: { ...manifest.engine, version: "2.53.2" } } : {}),
        ...(change === "commit" ? { engine: { ...manifest.engine, commit: "0".repeat(40) } } : {}),
        ...(change === "extra asset" || change === "traversal"
          ? {
              assets: [
                ...manifest.assets,
                {
                  ...required(manifest.assets[0]),
                  path: change === "traversal" ? "../escape.onnx" : "extra.onnx",
                },
              ],
            }
          : {}),
      };
      await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
        code: "INVALID_CONFIGURATION",
      });
      expect(runner).not.toHaveBeenCalled();
    }
  );

  it.each(["executable", "modelDirectory"] as const)("rejects traversal in %s", async (key) => {
    config[key] = `${directory}/nested/../${key}`;
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
  });

  it("requires an absolute Bubblewrap path", async () => {
    config.bubblewrapPath = "bwrap";
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
      code: "INVALID_CONFIGURATION",
    });
  });

  it("defaults to system Bubblewrap and fails when its readiness fails", async () => {
    config.bubblewrapPath = undefined;
    runner.mockResolvedValue({ ...success, success: false, exitCode: 1, stdout: "" });
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    expect(runner.mock.calls[0]?.[0]).toBe("/usr/bin/bwrap");
  });

  it.each([
    "bwrap: Can't mount proc on /proc: Operation not permitted\n",
    "bwrap: Creating new namespace failed: Operation not permitted\n",
    "bwrap: execvp /runtime/docling-rs: Permission denied\n",
  ])("fails closed on Bubblewrap startup failure: %s", async (stderr) => {
    runner.mockResolvedValue({ ...success, success: false, exitCode: 1, stdout: "", stderr });
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
      code: "ISOLATION_UNAVAILABLE",
      cause: { stderr, exitCode: 1 },
    });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]?.[0]).toBe(config.bubblewrapPath);
    await expect(
      access(required(required(required(runner.mock.calls[0])[2]).cwd))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["missing", "size", "hash", "directory", "symlink", "not executable"])(
    "rejects invalid executable: %s",
    async (change) => {
      if (change === "missing" || change === "directory" || change === "symlink")
        await rm(config.executable);
      if (change === "directory") await mkdir(config.executable);
      if (change === "symlink") await symlink(required(config.bubblewrapPath), config.executable);
      if (change === "size") await writeFile(config.executable, "short");
      if (change === "hash")
        await writeFile(config.executable, "x".repeat(nativeRuntimeManifest.executable.size));
      if (change === "not executable") await chmod(config.executable, 0o600);
      await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
        code: change === "missing" ? "RUNTIME_UNAVAILABLE" : "RUNTIME_INTEGRITY",
      });
      expect(runner).not.toHaveBeenCalled();
    }
  );

  it.each(nativeRuntimeManifest.assets.map((asset) => asset.path))(
    "checks SHA256 of asset %s",
    async (path) => {
      const filename = join(config.modelDirectory, path);
      const data = await readFile(filename);
      data[0] = required(data[0]) ^ 1;
      await writeFile(filename, data);
      await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
        code: "RUNTIME_INTEGRITY",
      });
      expect(runner).not.toHaveBeenCalled();
    }
  );

  it.each([
    "missing",
    "size",
    "symlink",
    "parent symlink",
    "root symlink",
    "extra model",
    "extra directory",
  ])("rejects invalid model installation: %s", async (change) => {
    const asset = required(nativeRuntimeManifest.assets[0]);
    const path = join(config.modelDirectory, asset.path);
    if (change === "missing" || change === "symlink") await rm(path);
    if (change === "size") await writeFile(path, "short");
    if (change === "symlink") await symlink(config.executable, path);
    if (change === "extra model")
      await writeFile(join(config.modelDirectory, "layout_heron_int8.onnx"), "unreviewed");
    if (change === "extra directory") await mkdir(join(config.modelDirectory, "extra"));
    if (change === "parent symlink") {
      const original = join(config.modelDirectory, "tableformer");
      await rm(original, { recursive: true });
      await symlink(directory, original);
    }
    if (change === "root symlink") {
      const linked = join(directory, "linked-models");
      await symlink(config.modelDirectory, linked);
      config.modelDirectory = linked;
    }
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
      code: change === "missing" ? "RUNTIME_UNAVAILABLE" : "RUNTIME_INTEGRITY",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects a symlink in executable ancestry", async () => {
    await symlink(directory, join(directory, "alias"));
    config.executable = join(directory, "alias", "docling-rs");
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({ code: "RUNTIME_INTEGRITY" });
  });

  it.each(["missing", "directory", "symlink", "not executable"])(
    "fails closed on unusable Bubblewrap: %s",
    async (change) => {
      if (change !== "not executable") await rm(required(config.bubblewrapPath));
      if (change === "directory") await mkdir(required(config.bubblewrapPath));
      if (change === "symlink") await symlink(config.executable, required(config.bubblewrapPath));
      if (change === "not executable") await chmod(required(config.bubblewrapPath), 0o600);
      await expect(verifyNativeRuntime(config)).rejects.toMatchObject({
        code: "ISOLATION_UNAVAILABLE",
      });
      expect(runner).not.toHaveBeenCalled();
    }
  );

  it.each([
    { ...success, stdout: "docling-rs 2.53.10 (chunking, mcp); ONNX Runtime 1.31\n" },
    { ...success, stdout: `prefix\n${version}` },
    { ...success, stdout: `${version}extra\n` },
    { ...success, stdout: `${version}\n` },
    { ...success, stdout: `${version.trimEnd()} ` },
    { ...success, stderr: "warning" },
    {
      ...success,
      stderr: "Secure opened-file canonicalization requires procfs at /proc/self/fd/3",
    },
  ])("rejects an unexpected version protocol", async (result) => {
    runner.mockResolvedValue(result);
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({ code: "RUNTIME_INTEGRITY" });
    await expect(
      access(required(required(required(runner.mock.calls[0])[2]).cwd))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    [new ProcessTimeoutError(10000), "TIMEOUT"],
    [new ProcessAbortError(), "ABORTED"],
    [Object.assign(new Error("spawn failed"), { code: "ENOENT" }), "ISOLATION_UNAVAILABLE"],
  ] as const)("cleans readiness directory on runner failure", async (error, code) => {
    runner.mockRejectedValue(error);
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({ code });
    await expect(
      access(required(required(required(runner.mock.calls[0])[2]).cwd))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("aborts before file verification", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(verifyNativeRuntime(config, controller.signal)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("supports cancellation during verification", async () => {
    const controller = new AbortController();
    const verifying = verifyNativeRuntime(config, controller.signal);
    setImmediate(() => controller.abort());
    await expect(verifying).rejects.toMatchObject({ code: "ABORTED" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("does not cache successful verification across calls", async () => {
    await verifyNativeRuntime(config);
    await writeFile(
      join(config.modelDirectory, required(nativeRuntimeManifest.assets[0]).path),
      "tampered"
    );
    await expect(verifyNativeRuntime(config)).rejects.toMatchObject({ code: "RUNTIME_INTEGRITY" });
    expect(runner).toHaveBeenCalledTimes(1);
    await access(config.executable, constants.X_OK);
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing required test fixture");
  return value;
}
