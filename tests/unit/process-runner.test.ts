import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProcessAbortError,
  ProcessOutputLimitError,
  type ProcessRunOptions,
  ProcessTimeoutError,
  runProcess,
} from "../../src/cli/process-runner";

const posix = process.platform !== "win32";
let directory: string;
let nextStub: number;
let signalsBefore: { int: number; term: number };
const groups: number[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "docling process "));
  nextStub = 0;
  signalsBefore = {
    int: process.listenerCount("SIGINT"),
    term: process.listenerCount("SIGTERM"),
  };
});

afterEach(() => {
  for (const pid of groups.splice(0)) {
    try {
      process.kill(posix ? -pid : pid, "SIGKILL");
    } catch {
      // Successful runs already reaped the child and terminated its group.
    }
  }
  rmSync(directory, { recursive: true, force: true });
  expect(process.listenerCount("SIGINT")).toBe(signalsBefore.int);
  expect(process.listenerCount("SIGTERM")).toBe(signalsBefore.term);
});

function stub(source: string, options: ProcessRunOptions = {}, args: string[] = []) {
  const filename = join(directory, `stub ${nextStub++}.cjs`);
  writeFileSync(filename, source);
  return runProcess(process.execPath, [filename, ...args], { timeout: 5000, ...options });
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // Linux containers may leave orphan zombies until their init reaps them.
    // Zombies cannot execute or retain pipes, but kill(pid, 0) still finds them.
    if (process.platform === "linux") {
      return !/^.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
    }
    return true;
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

function trackPid(chunk: string): number {
  const pid = Number(chunk.trim());
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  groups.push(pid);
  return pid;
}

describe("runProcess executable/argv and results", () => {
  it("captures separate streams, literal argv, cwd and environment", async () => {
    const args = ["", "space in a.pdf", "$(printf SHELL)", "a;echo injected", "quotes'\"", "a&b|c"];
    const stdout = vi.fn();
    const stderr = vi.fn();
    const result = await stub(
      `process.stdout.write(JSON.stringify({args: process.argv.slice(2), cwd: process.cwd(), env: process.env.RUNNER_TEST})); process.stderr.write('warning');`,
      {
        cwd: directory,
        env: { ...process.env, RUNNER_TEST: "literal" },
        onStdout: stdout,
        onStderr: stderr,
      },
      args
    );
    expect(result).toMatchObject({ success: true, exitCode: 0, signal: null, stderr: "warning" });
    expect(JSON.parse(result.stdout)).toEqual({ args, cwd: directory, env: "literal" });
    expect(stdout.mock.calls.flat().join("")).toBe(result.stdout);
    expect(stderr.mock.calls.flat().join("")).toBe("warning");
  });

  it("returns nonzero exits without rejecting", async () => {
    expect(await stub("process.exitCode = 7;")).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 7,
      signal: null,
      success: false,
    });
  });

  it.skipIf(!posix)("preserves signal exits instead of reporting success", async () => {
    const result = await stub("process.kill(process.pid, 'SIGTERM');");
    expect(result).toMatchObject({ success: false, exitCode: null, signal: "SIGTERM" });
  });

  it("retains the original missing-executable error and cleans abort listeners", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(
      runProcess(join(directory, "not-an-executable"), [], { signal: controller.signal })
    ).rejects.toMatchObject({ code: "ENOENT", syscall: expect.stringContaining("spawn") });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("handles synchronous spawn validation failures without installing listeners", async () => {
    await expect(runProcess("invalid\0executable", [])).rejects.toBeInstanceOf(TypeError);
  });

  it("ignores output when stdio is ignored", async () => {
    const result = await stub("console.log('ignored'); console.error('ignored');", {
      stdio: "ignore",
    });
    expect(result).toMatchObject({ success: true, stdout: "", stderr: "" });
  });

  it("bounds combined output before invoking callbacks beyond the limit", async () => {
    let received = "";
    await expect(
      stub(
        "process.stdout.write('123456'); setTimeout(() => { process.stderr.write('abcdef'); }, 20); setInterval(() => {}, 1000);",
        {
          maxBuffer: 8,
          onStdout: (chunk) => {
            received += chunk;
          },
          onStderr: (chunk) => {
            received += chunk;
          },
        }
      )
    ).rejects.toMatchObject({ name: "ProcessOutputLimitError", maxBuffer: 8 });
    expect(Buffer.byteLength(received)).toBeLessThanOrEqual(8);
    expect(new ProcessOutputLimitError(8)).toBeInstanceOf(Error);
  });

  it("decodes UTF-8 split across chunks without changing content", async () => {
    const result = await stub(
      "process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x82, 0xac])), 20);"
    );
    expect(result.stdout).toBe("€");
  });
});

describe("runProcess cancellation and cleanup", () => {
  it("does not spawn for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runProcess(join(directory, "missing"), [], { signal: controller.signal })
    ).rejects.toBeInstanceOf(ProcessAbortError);
  });

  it("rejects timeout only after the direct child is reaped", async () => {
    let pid = 0;
    const result = stub("console.log(process.pid); setInterval(() => {}, 1000);", {
      timeout: 1000,
      onStdout: (chunk) => {
        pid = trackPid(chunk);
      },
    });
    await expect(result).rejects.toMatchObject({ name: "ProcessTimeoutError", timeout: 1000 });
    expect(pid).toBeGreaterThan(0);
    expect(running(pid)).toBe(false);
    expect(new ProcessTimeoutError(1).timeout).toBe(1);
  });

  it("aborts a running child, removes the listener and cannot become success", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let pid = 0;
    const result = stub(
      "process.on('SIGTERM', () => process.exit(0)); console.log(process.pid); setInterval(() => {}, 1000);",
      {
        signal: controller.signal,
        onStdout: (chunk) => {
          pid = trackPid(chunk);
          controller.abort();
        },
      }
    );
    await expect(result).rejects.toBeInstanceOf(ProcessAbortError);
    expect(running(pid)).toBe(false);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it.skipIf(!posix)("escalates when the live child ignores SIGTERM", async () => {
    const controller = new AbortController();
    const marker = join(directory, "sigterm-seen");
    let pid = 0;
    const result = stub(
      `process.on('SIGTERM', () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'seen')); console.log(process.pid); setInterval(() => {}, 1000);`,
      {
        signal: controller.signal,
        onStdout: (chunk) => {
          pid = trackPid(chunk);
          controller.abort();
        },
      }
    );
    await expect(result).rejects.toBeInstanceOf(ProcessAbortError);
    expect(existsSync(marker)).toBe(true);
    expect(running(pid)).toBe(false);
  });

  it("terminates and cleans up before propagating callback exceptions", async () => {
    const failure = new Error("callback failed");
    let pid = 0;
    await expect(
      stub("console.log(process.pid); setInterval(() => {}, 1000);", {
        onStdout: (chunk) => {
          pid = trackPid(chunk);
          throw failure;
        },
      })
    ).rejects.toBe(failure);
    expect(running(pid)).toBe(false);
  });

  it("clears the success timeout and abort listener before settlement", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    try {
      const result = await stub("console.log('done');", {
        timeout: 2000,
        signal: controller.signal,
      });
      expect(result.success).toBe(true);
      const index = schedule.mock.calls.findIndex((call) => call[1] === 2000);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(clear).toHaveBeenCalledWith(schedule.mock.results[index]?.value);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      controller.abort();
    } finally {
      schedule.mockRestore();
      clear.mockRestore();
    }
  });

  it.skipIf(!posix).each(["inherit", "ignore"] as const)(
    "kills descendants with %s stdio after the parent exits",
    async (stdio) => {
      const childPidFile = join(directory, "descendant.pid");
      const termMarker = join(directory, "descendant.term");
      const descendant = `
      const fs = require('node:fs');
      process.on('SIGTERM', () => fs.writeFileSync(${JSON.stringify(termMarker)}, 'seen'));
      fs.writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));
      console.log('descendant ready');
      setInterval(() => {}, 1000);
    `;
      const result = await stub(
        `
      const fs = require('node:fs');
      require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio: ['ignore', ${JSON.stringify(stdio)}, ${JSON.stringify(stdio)}]});
      console.error(process.pid);
      setInterval(() => { if (fs.existsSync(${JSON.stringify(childPidFile)})) process.exit(0); }, 10);
    `,
        {
          onStderr: (chunk) => {
            trackPid(chunk);
          },
        }
      );
      expect(result).toMatchObject({ success: true, exitCode: 0, signal: null });
      if (stdio === "inherit") expect(result.stdout).toContain("descendant ready");
      else expect(result.stdout).toBe("");
      expect(existsSync(termMarker)).toBe(true);
      const pid = Number(readFileSync(childPidFile, "utf8"));
      await expect.poll(() => running(pid), { timeout: 2000 }).toBe(false);
    }
  );
  it.skipIf(!posix)(
    "bounds pipe cleanup when a descendant leaves the owned process group",
    async () => {
      const childPidFile = join(directory, "escaped.pid");
      const descendant = `
      require('node:fs').writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid));
      console.log(process.pid);
      setInterval(() => {}, 1000);
    `;
      let descendantPid = 0;
      const result = await stub(
        `
      const fs = require('node:fs');
      require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {detached: true, stdio: ['ignore', 'inherit', 'inherit']});
      console.error(process.pid);
      setInterval(() => { if (fs.existsSync(${JSON.stringify(childPidFile)})) process.exit(0); }, 10);
    `,
        {
          onStdout: (chunk) => {
            descendantPid = trackPid(chunk);
          },
          onStderr: (chunk) => {
            trackPid(chunk);
          },
        }
      );
      expect(result.success).toBe(true);
      // Leaving the group escapes runner ownership. The fixture owns this cleanup.
      expect(running(descendantPid)).toBe(true);
      process.kill(-descendantPid, "SIGKILL");
      await expect.poll(() => running(descendantPid), { timeout: 2000 }).toBe(false);
    }
  );

  it.skipIf(!posix).each(["SIGINT", "SIGTERM"] as const)(
    "forwards parent %s and cleans listeners before rejecting in an isolated harness",
    async (signal) => {
      const filename = join(directory, "parent.cjs");
      const runnerUrl = pathToFileURL(resolve("src/cli/process-runner.ts")).href;
      writeFileSync(
        filename,
        `
        (async () => {
          const { runProcess } = await import(${JSON.stringify(runnerUrl)});
          const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
          try {
            await runProcess(process.execPath, ['-e', "process.on('${signal}', () => process.exit(0)); console.log('ready'); setInterval(() => {}, 1000);"], {
              timeout: 5000,
              onStdout: () => console.log('READY:' + process.pid)
            });
            process.exitCode = 9;
          } catch (error) {
            console.log(JSON.stringify({ name: error.name, clean: before[0] === process.listenerCount('SIGINT') && before[1] === process.listenerCount('SIGTERM') }));
          }
        })();
      `
      );
      let sent = false;
      const result = await runProcess(process.execPath, ["--import", "tsx", filename], {
        timeout: 8000,
        onStdout: (chunk) => {
          const match = chunk.match(/READY:(\d+)/);
          if (match?.[1] && !sent) {
            sent = true;
            const pid = Number(match[1]);
            groups.push(pid);
            process.kill(pid, signal);
          }
        },
      });
      expect(sent).toBe(true);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('"name":"ProcessAbortError","clean":true');
    }
  );
});
