import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessAbortError, ProcessOutputLimitError } from "../../src/cli/process-runner";
import { CliUtils } from "../../src/cli/utils";
import { CliNotFoundError, CliTimeoutError } from "../../src/types/cli";

let directory: string;
let cli: CliUtils;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "docling cli "));
  cli = new CliUtils({
    doclingPath: process.execPath,
    doclingToolsPath: process.execPath,
    timeout: 5000,
  });
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe.each(["execute", "executeAsync", "executeTools", "executeToolsAsync"] as const)(
  "CliUtils.%s",
  (method) => {
    it("preserves literal arguments and nonzero status", async () => {
      const arg = "literal $(printf INJECTED); & file.pdf";
      const result = await cli[method]([
        "-e",
        "console.log(process.argv[1]); process.exitCode = 4;",
        arg,
      ]);
      expect(result).toMatchObject({
        success: false,
        exitCode: 4,
        signal: null,
        stdout: `${arg}\n`,
      });
    });

    it.skipIf(process.platform === "win32")(
      "maps signal exits to a documented nonzero sentinel",
      async () => {
        const result = await cli[method](["-e", "process.kill(process.pid, 'SIGTERM');"]);
        expect(result).toMatchObject({ success: false, exitCode: -1, signal: "SIGTERM" });
      }
    );

    it("maps missing executables to CliNotFoundError", async () => {
      const missing = join(directory, "not-installed");
      cli.updateConfig({ doclingPath: missing, doclingToolsPath: missing });
      await expect(cli[method](["--version"])).rejects.toBeInstanceOf(CliNotFoundError);
    });

    it("maps timeout errors after runner cleanup", async () => {
      await expect(
        cli[method](["-e", "setInterval(() => {}, 1000);"], { timeout: 30 })
      ).rejects.toBeInstanceOf(CliTimeoutError);
    });

    it("honors timeout zero over the configured timeout", async () => {
      cli.updateConfig({ timeout: 1 });
      const result = await cli[method](["-e", "setTimeout(() => console.log('done'), 40);"], {
        timeout: 0,
      });
      expect(result).toMatchObject({ success: true, stdout: "done\n" });
    });

    it("accepts an already-aborted signal", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        cli[method](["-e", "process.exit(0)"], { signal: controller.signal })
      ).rejects.toBeInstanceOf(ProcessAbortError);
    });

    it("propagates bounded-output errors", async () => {
      await expect(
        cli[method](["-e", "console.log('too much output');"], { maxBuffer: 2 })
      ).rejects.toBeInstanceOf(ProcessOutputLimitError);
    });
  }
);

it("streams progress in the async path", async () => {
  const progress = vi.fn();
  const result = await cli.executeAsync(["-e", "console.log('out'); console.error('err');"], {
    onProgress: progress,
  });
  expect(result.success).toBe(true);
  expect(progress).toHaveBeenCalledWith({ type: "stdout", data: "out\n" });
  expect(progress).toHaveBeenCalledWith({ type: "stderr", data: "err\n" });
});

it("propagates async progress exceptions after cleanup", async () => {
  const failure = new Error("progress failure");
  await expect(
    cli.executeAsync(["-e", "console.log('ready'); setInterval(() => {}, 1000);"], {
      onProgress: () => {
        throw failure;
      },
    })
  ).rejects.toBe(failure);
});
