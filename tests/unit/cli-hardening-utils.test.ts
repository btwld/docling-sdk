import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError, CliNotFoundError, CliUtils, CliValidation } from "../../src/cli-entry";
import { ProcessAbortError, runProcess } from "../../src/cli/process-runner";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("public CLI utility readiness and configuration", () => {
  it("reports a working executable version and availability", async () => {
    const utils = new CliUtils({ doclingPath: process.execPath });
    expect(await utils.getVersion()).toBe(process.version);
    expect(await utils.checkAvailability()).toBe(true);
    expect(() => utils.validateConfig()).not.toThrow();
    const config = utils.getConfig();
    config.doclingPath = "changed externally";
    expect(utils.getConfig().doclingPath).toBe(process.execPath);
    utils.updateConfig({ timeout: 21 });
    expect(utils.getConfig().timeout).toBe(21);
  });

  it("reports unavailable configuration without claiming readiness", async () => {
    const utils = new CliUtils({ doclingPath: "/not-installed/docling-cli-test" });
    await expect(utils.getVersion()).rejects.toBeInstanceOf(CliNotFoundError);
    expect(await utils.checkAvailability()).toBe(false);
    utils.updateConfig({ doclingPath: "" });
    expect(() => utils.validateConfig()).toThrow(CliNotFoundError);
  });

  it("keeps configuration and per-call cwd/environment precedence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cli-utils-env-"));
    directories.push(directory);
    const utils = new CliUtils({
      doclingPath: process.execPath,
      cwd: directory,
      env: { SDK_CONTROLLED_TEST: "configured", SDK_CONFIG_ONLY: "retained" },
    });
    const result = await utils.execute(
      [
        "-e",
        "console.log(JSON.stringify([process.cwd(),process.env.SDK_CONTROLLED_TEST,process.env.SDK_CONFIG_ONLY]))",
      ],
      { env: { SDK_CONTROLLED_TEST: "per-call" } }
    );
    expect(JSON.parse(result.stdout)).toEqual([directory, "per-call", "retained"]);
  });

  it("monitors the actual child streams and tolerates missing callbacks", async () => {
    const utils = new CliUtils();
    const child = spawn(process.execPath, ["-e", "console.log('out');console.error('err')"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const progress = vi.fn();
    utils.monitorProgress(child);
    utils.monitorProgress(child, progress);
    await once(child, "close");
    expect(progress).toHaveBeenCalledWith({ type: "stdout", data: "out\n" });
    expect(progress).toHaveBeenCalledWith({ type: "stderr", data: "err\n" });
    const ignored = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    utils.monitorProgress(ignored, progress);
    await once(ignored, "close");
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it("builds literal options including acronyms and reports malformed JSON context", () => {
    const utils = new CliUtils();
    expect(
      utils.buildArgs("convert", {
        HTMLParser: "literal '$()'",
        retries: 0,
        enabled: false,
        optional: undefined,
        absent: null,
        sources: [],
      })
    ).toEqual(["convert", "--html-parser", "literal '$()'", "--retries", "0"]);
    expect(utils.extractOutputFiles("Output: /a b\nWRITTEN TO: /c\nnoise\nSaved to: /d")).toEqual([
      "/a b",
      "/c",
      "/d",
    ]);
    expect(utils.parseOutput("hello")).toBe("hello");
    expect(utils.escapeArg("a'b")).toBe(process.platform === "win32" ? '"a\'b"' : "'a'\"'\"'b'");
    try {
      utils.parseOutput("{invalid}", "json");
      throw new Error("Expected invalid JSON rejection");
    } catch (error) {
      expect(error).toMatchObject({ name: "CliError", stdout: "{invalid}", exitCode: 1 });
      expect(error).toBeInstanceOf(CliError);
    }
  });
});

it.each([
  ["isValidInputFormat", "docx"],
  ["isValidOutputFormat", "md"],
  ["isValidOcrEngine", "rapidocr"],
  ["isValidPdfBackend", "dlparse_v4"],
  ["isValidTableMode", "accurate"],
  ["isValidImageExportMode", "referenced"],
  ["isValidProcessingPipeline", "standard"],
  ["isValidVlmModel", "smoldocling"],
  ["isValidAsrModel", "whisper_small"],
  ["isValidAcceleratorDevice", "cpu"],
  ["isValidAvailableModel", "layout"],
] as const)("validates %s through its exported contract", (validator, accepted) => {
  expect(CliValidation[validator](accepted)).toBe(true);
  expect(CliValidation[validator]("unrecognized-option")).toBe(false);
});

it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
  "rejects invalid timeout %s before starting an executable",
  async (timeout) => {
    await expect(runProcess("/not-installed/invalid-options", [], { timeout })).rejects.toThrow(
      "timeout must be between"
    );
  }
);
it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid output limit %s before spawning",
  async (maxBuffer) => {
    await expect(runProcess("/not-installed/invalid-options", [], { maxBuffer })).rejects.toThrow(
      "maxBuffer must be a nonnegative safe integer"
    );
  }
);
it.skipIf(process.platform === "win32").each(["SIGINT", "SIGTERM"] as const)(
  "propagates the parent's %s event through the runner",
  async (signal) => {
    const before = process.listenerCount(signal);
    let delivered = false;
    await expect(
      runProcess(process.execPath, ["-e", "console.log('ready');setInterval(()=>{},1000)"], {
        timeout: 5000,
        onStdout: () => {
          delivered = true;
          process.emit(signal, signal);
        },
      })
    ).rejects.toBeInstanceOf(ProcessAbortError);
    expect(delivered).toBe(true);
    expect(process.listenerCount(signal)).toBe(before);
  }
);

it.each(["csv", "xml_uspto", "xml_jats", "json_docling", "audio"])(
  "accepts the public input format %s",
  (format) => {
    expect(CliValidation.isValidInputFormat(format)).toBe(true);
  }
);
it("accepts split HTML and the public ASR pipeline", () => {
  expect(CliValidation.isValidOutputFormat("html_split_page")).toBe(true);
  expect(CliValidation.isValidProcessingPipeline("asr")).toBe(true);
});

it.skipIf(process.platform === "win32")(
  "escalates after an OS group-signal error while preserving the original abort",
  async () => {
    const controller = new AbortController();
    const kill = process.kill.bind(process);
    let denied = false;
    let childPid = 0;
    const signal = vi.spyOn(process, "kill").mockImplementation((pid, requested) => {
      if (pid === -childPid && requested === "SIGTERM" && !denied) {
        denied = true;
        throw Object.assign(new Error("Synthetic OS permission denial"), { code: "EPERM" });
      }
      return kill(pid, requested);
    });
    try {
      await expect(
        runProcess(process.execPath, ["-e", "console.log(process.pid);setInterval(()=>{},1000)"], {
          signal: controller.signal,
          timeout: 5000,
          onStdout: (chunk) => {
            childPid = Number(chunk.trim());
            controller.abort();
          },
        })
      ).rejects.toBeInstanceOf(ProcessAbortError);
      expect(denied).toBe(true);
      expect(signal).toHaveBeenCalledWith(-childPid, "SIGKILL");
      expect(() => kill(childPid, 0)).toThrow();
    } finally {
      signal.mockRestore();
      if (childPid) {
        try {
          kill(-childPid, "SIGKILL");
        } catch {}
      }
    }
  }
);
