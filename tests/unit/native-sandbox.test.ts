import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as runner from "../../src/cli/process-runner";
import { NATIVE_LIMITS } from "../../src/native/limits";
import type { PreparedNativeRuntime } from "../../src/native/runtime";
import { runNativeProcess } from "../../src/native/sandbox";

let directory: string;
let runtime: PreparedNativeRuntime;
let workDirectory: string;
const success = { stdout: "", stderr: "", success: true, exitCode: 0, signal: null } as const;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "native-sandbox-test-"));
  workDirectory = join(directory, "work");
  const modelDirectory = join(directory, "models");
  await mkdir(workDirectory);
  await mkdir(modelDirectory);
  runtime = {
    executable: "/usr/bin/bash",
    modelDirectory,
    bubblewrapPath: "/usr/bin/bwrap",
    identity: {
      profile: "sandbox-test",
      engine: "docling-rs",
      version: "2.53.1",
      commit: "test",
      platform: "linux-x64",
      executableSha256: "test",
      manifestSha256: "test",
      isolation: "bubblewrap",
    },
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("runNativeProcess public boundary with deterministic runner", () => {
  it("passes the fixed mounts, namespaces, literal argv and a clean environment to runProcess", async () => {
    const run = vi.spyOn(runner, "runProcess").mockResolvedValue(success);
    const controller = new AbortController();
    const argv = ["/work/input name.pdf", "--output", "/work/output", "$(touch /tmp/injected);'\""];
    await runNativeProcess(runtime, workDirectory, argv, {
      timeoutMs: 1234,
      signal: controller.signal,
    });
    const [executable, args, options] = required(run.mock.calls[0]);
    expect(executable).toBe("/usr/bin/bwrap");
    expect(args.slice(-argv.length - 2)).toEqual(["--", "/runtime/docling-rs", ...argv]);
    expect(args.slice(0, 5)).toEqual([
      "--unshare-all",
      "--die-with-parent",
      "--cap-drop",
      "ALL",
      "--clearenv",
    ]);
    expect(args.filter((arg) => arg === "--proc")).toHaveLength(1);
    expect(args.filter((arg) => arg === "/proc")).toHaveLength(1);
    expect(args.slice(args.indexOf("--proc"), args.indexOf("--proc") + 2)).toEqual([
      "--proc",
      "/proc",
    ]);
    const mounts: string[][] = [];
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--bind" || args[index] === "--ro-bind")
        mounts.push(args.slice(index, index + 3));
    }
    expect(mounts).toContainEqual(["--bind", workDirectory, "/work"]);
    expect(mounts).toContainEqual(["--ro-bind", runtime.executable, "/runtime/docling-rs"]);
    expect(mounts).toContainEqual(["--ro-bind", runtime.modelDirectory, "/models"]);
    expect(
      mounts.every(([, source]) =>
        [
          workDirectory,
          runtime.executable,
          runtime.modelDirectory,
          "/usr/lib",
          "/usr/lib64",
          "/lib",
          "/lib64",
        ].includes(required(source))
      )
    ).toBe(true);
    for (const forbidden of ["--new-session", "--preserve-fds", "--share-net", "--share-pid"])
      expect(args).not.toContain(forbidden);
    expect(args).toContain("--dev");
    expect(args).toContain("--tmpfs");
    expect(options).toEqual({
      cwd: workDirectory,
      env: {},
      signal: controller.signal,
      timeout: 1234,
      maxBuffer: NATIVE_LIMITS.diagnosticBytes,
    });
    const env: Record<string, string> = {};
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--setenv") env[required(args[index + 1])] = required(args[index + 2]);
    }
    expect(env).toMatchObject({
      DOCLING_RS_MODELS_DIR: "/models",
      DOCLING_LAYOUT_ONNX: "/models/layout_heron.onnx",
      DOCLING_OCR_REC_ONNX: "/models/ocr_rec_v6.onnx",
      DOCLING_OCR_DICT: "/models/ocr_rec_v6_dict.txt",
      DOCLING_OCR_DET_ONNX: "/models/ocr_det.onnx",
      DOCLING_TABLEFORMER_ENCODER: "/models/tableformer/encoder_fp16.onnx",
      DOCLING_TABLEFORMER_DECODER: "/models/tableformer/decoder_kv_layers.onnx",
      DOCLING_TABLEFORMER_BBOX: "/models/tableformer/bbox.onnx",
      DOCLING_RS_EP: "cpu",
      DOCLING_RS_PDF_THREADS: "2",
      DOCLING_RS_PDF_WORKERS: "1",
      DOCLING_RS_OCR_SESSIONS: "1",
      DOCLING_RS_SYSTEM_FONTS: "0",
    });
    expect(
      Object.keys(env).some((key) => /proxy|token|secret|LD_PRELOAD|LD_LIBRARY_PATH/i.test(key))
    ).toBe(false);
  });

  it("points fonts only at the supplied model bundle when present", async () => {
    await mkdir(join(runtime.modelDirectory, "fonts"));
    const run = vi.spyOn(runner, "runProcess").mockResolvedValue(success);
    await runNativeProcess(runtime, workDirectory, ["--version"], { timeoutMs: 1000 });
    const args = required(run.mock.calls[0])[1];
    const index = args.indexOf("DOCLING_RS_FONT_DIRS");
    expect(args.slice(index - 1, index + 2)).toEqual([
      "--setenv",
      "DOCLING_RS_FONT_DIRS",
      "/models/fonts",
    ]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, NATIVE_LIMITS.maxTimeoutMs + 1])(
    "rejects invalid timeout %s",
    async (timeoutMs) => {
      const run = vi.spyOn(runner, "runProcess");
      await expect(
        runNativeProcess(runtime, workDirectory, [], { timeoutMs })
      ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
      expect(run).not.toHaveBeenCalled();
    }
  );

  it("rejects relative sandbox paths", async () => {
    runtime.bubblewrapPath = "bwrap";
    await expect(
      runNativeProcess(runtime, workDirectory, [], { timeoutMs: 1000 })
    ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  });

  it("rejects pre-aborted work without spawning", async () => {
    const run = vi.spyOn(runner, "runProcess");
    const controller = new AbortController();
    controller.abort();
    await expect(
      runNativeProcess(runtime, workDirectory, [], { timeoutMs: 1000, signal: controller.signal })
    ).rejects.toMatchObject({ code: "ABORTED" });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    "bwrap: Can't mount proc on /proc: Operation not permitted\n",
    "bwrap: Creating new namespace failed: Operation not permitted\n",
    "bwrap: No permissions to create new namespace\n",
    "bwrap: Unexpected capabilities but not setuid, old file caps config?\n",
    "bwrap: execvp /runtime/docling-rs: No such file or directory\n",
  ])("classifies nonzero Bubblewrap startup failure without a retry: %s", async (stderr) => {
    const failed = { ...success, success: false, exitCode: 1, stderr };
    const run = vi.spyOn(runner, "runProcess").mockResolvedValue(failed);
    await expect(
      runNativeProcess(runtime, workDirectory, [], { timeoutMs: 1000 })
    ).rejects.toMatchObject({ code: "ISOLATION_UNAVAILABLE", cause: failed });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(runtime.bubblewrapPath);
    const args = required(run.mock.calls[0])[1];
    expect(args).toContain("--proc");
    expect(args).toContain("--unshare-all");
  });

  it("returns unsuccessful engine exits without retrying or reclassifying them", async () => {
    const failed = {
      ...success,
      success: false,
      exitCode: 1,
      stderr: "error: failed to convert input",
    };
    const run = vi.spyOn(runner, "runProcess").mockResolvedValue(failed);
    expect(await runNativeProcess(runtime, workDirectory, [], { timeoutMs: 1000 })).toEqual(failed);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(runtime.bubblewrapPath);
  });

  it("preserves successful process diagnostics", async () => {
    const result = {
      ...success,
      stderr: "Error in cpuinfo: failed to parse processor information from /proc/cpuinfo\n",
    };
    vi.spyOn(runner, "runProcess").mockResolvedValue(result);
    expect(await runNativeProcess(runtime, workDirectory, [], { timeoutMs: 1000 })).toEqual(result);
  });
});

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "real harmless sandbox processes",
  () => {
    let unavailableReason: string | undefined;
    beforeAll(async () => {
      try {
        await access("/usr/bin/bwrap");
        const args = [
          "--unshare-all",
          "--die-with-parent",
          "--cap-drop",
          "ALL",
          "--clearenv",
          "--proc",
          "/proc",
        ];
        for (const path of ["/usr/lib", "/usr/lib64", "/lib", "/lib64"]) {
          try {
            if ((await stat(path)).isDirectory()) args.push("--ro-bind", path, path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        args.push(
          "--ro-bind",
          await realpath("/usr/bin/bash"),
          "/shell",
          "--",
          "/shell",
          "-c",
          'exec 3</proc/self/status && IFS= read -r status < /proc/self/fd/3 && test -n "$status" && printf private-procfs'
        );
        // Probe the required procfs mount as well as user/PID/network namespaces.
        // Only known capability denials skip; unexpected startup errors fail CI.
        // On this VM the test command drops ambient capabilities outside the SDK.
        const probe = await runner.runProcess("/usr/bin/bwrap", args, {
          env: {},
          timeout: 3000,
          maxBuffer: NATIVE_LIMITS.diagnosticBytes,
        });
        const denial = probe.stderr.match(
          /^bwrap: (?:Can't mount proc on \/proc: (?:Operation not permitted|Permission denied|No such device)|Creating new namespace failed: (?:Operation not permitted|Permission denied)|No permissions to create new namespace[^\n]*|Unexpected capabilities but not setuid, old file caps config\?)/m
        );
        if (probe.exitCode !== null && probe.exitCode !== 0 && denial) {
          unavailableReason = `Bubblewrap capability check cannot provide --unshare-all --proc /proc (exit ${probe.exitCode}): ${denial[0]}`;
          return;
        }
        expect(probe).toMatchObject({
          success: true,
          exitCode: 0,
          signal: null,
          stdout: "private-procfs",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        unavailableReason =
          "Bubblewrap procfs capability check unavailable: /usr/bin/bwrap or /usr/bin/bash is missing";
      }
    });

    it("exposes only private writable work/tmp and read-only models/runtime", async (context) => {
      if (unavailableReason) context.skip(unavailableReason);
      await writeFile(join(runtime.modelDirectory, "model.txt"), "reviewed");
      await writeFile(join(directory, "host-secret"), "hidden");
      const script = `
      test "$PWD" = /work || exit 10
      for path in /home /run /etc /usr/bin /tmp/host-secret; do test ! -e "$path" || exit 11; done
      test ! -e '${directory}/host-secret' || exit 12
      test -z "$HTTP_PROXY$HTTPS_PROXY$LD_PRELOAD$LD_LIBRARY_PATH" || exit 13
      test "$DOCLING_RS_MODELS_DIR" = /models || exit 14
      test "$DOCLING_RS_EP" = cpu || exit 15
      test -c /dev/null || exit 16
      test ! -e /dev/shm/host-secret || exit 17
      printf private > /tmp/private-file || exit 18
      printf output > /work/result || exit 19
      if (printf overwrite > /models/model.txt) 2>/dev/null; then exit 20; fi
      if (printf overwrite > /runtime/docling-rs) 2>/dev/null; then exit 21; fi
      read -r model < /models/model.txt
      test "$model" = reviewed || exit 22
      test -r /proc/self/status && test -r /proc/1/status || exit 23
      test /proc/self/ns/pid -ef /proc/1/ns/pid || exit 24
      while IFS= read -r line; do
        case "$line" in
          NSpid:*) set -- $line; test "$#" = 2 && test "$2" = "$$" || exit 25; found_pid=1 ;;
        esac
      done < /proc/self/status
      test "$found_pid" = 1 || exit 26
      exec 3</models/model.txt || exit 27
      read -r fd_model < /proc/self/fd/3
      test "$fd_model" = reviewed || exit 28
      printf isolated
    `;
      const result = await runNativeProcess(runtime, workDirectory, ["-c", script], {
        timeoutMs: 3000,
      });
      expect(result).toMatchObject({ success: true, stdout: "isolated" });
      expect(await readFile(join(workDirectory, "result"), "utf8")).toBe("output");
      expect(await readFile(join(runtime.modelDirectory, "model.txt"), "utf8")).toBe("reviewed");
    });

    it("preserves literal argv without a command shell", async (context) => {
      if (unavailableReason) context.skip(unavailableReason);
      const literal = "space ' quote $(printf injected); & |";
      const result = await runNativeProcess(
        runtime,
        workDirectory,
        ["-c", 'printf "%s" "$1"', "test", literal],
        { timeoutMs: 3000 }
      );
      expect(result).toMatchObject({ success: true, stdout: literal });
    });

    it("cannot reach the host loopback listener or external network", async (context) => {
      if (unavailableReason) context.skip(unavailableReason);
      const server = createServer((socket) => socket.destroy());
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("Missing listener address");
        const script = `
          if (exec 3<>/dev/tcp/127.0.0.1/${address.port}) 2>/dev/null; then exit 10; fi
          if (exec 3<>/dev/tcp/1.1.1.1/443) 2>/dev/null; then exit 11; fi
          printf offline
        `;
        expect(
          await runNativeProcess(runtime, workDirectory, ["-c", script], { timeoutMs: 3000 })
        ).toMatchObject({ success: true, stdout: "offline" });
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    });

    it("enforces timeout on a busy process and its descendant", async (context) => {
      if (unavailableReason) context.skip(unavailableReason);
      await expect(
        runNativeProcess(
          runtime,
          workDirectory,
          ["-c", "/runtime/docling-rs -c 'while :; do :; done' & wait"],
          { timeoutMs: 100 }
        )
      ).rejects.toMatchObject({ code: "TIMEOUT" });
    });

    it("aborts a running process", async (context) => {
      if (unavailableReason) context.skip(unavailableReason);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 100);
      try {
        await expect(
          runNativeProcess(runtime, workDirectory, ["-c", "while :; do :; done"], {
            timeoutMs: 3000,
            signal: controller.signal,
          })
        ).rejects.toMatchObject({ code: "ABORTED" });
      } finally {
        clearTimeout(timer);
      }
    });

    it("kills a descendant after its direct shell parent exits", async (context) => {
      if (unavailableReason) context.skip(unavailableReason);
      const result = await runNativeProcess(
        runtime,
        workDirectory,
        [
          "-c",
          "/runtime/docling-rs -c 'while :; do printf x >> /work/heartbeat; done' & while test ! -e /work/heartbeat; do :; done; exit 0",
        ],
        { timeoutMs: 3000 }
      );
      expect(result.success).toBe(true);
      const before = await readFile(join(workDirectory, "heartbeat")).catch(() => Buffer.alloc(0));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const after = await readFile(join(workDirectory, "heartbeat")).catch(() => Buffer.alloc(0));
      expect(before.equals(after)).toBe(true);
    });
  }
);

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing required test fixture");
  return value;
}
