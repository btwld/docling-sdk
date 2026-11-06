import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runProcess } from "../../src/cli/process-runner";
import { type ConversionOptions, type DoclingCLIConfig, createCLIClient } from "../../src/index";

const directories: string[] = [];
const clients: ReturnType<typeof createCLIClient>[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

interface StubConfig {
  behavior?: string;
  formats?: Record<string, string>;
  files?: Record<string, string>;
  signalExitDelays?: Record<string, number>;
  delay?: number;
  status?: string;
  jsonStatus?: string;
  jsonValue?: unknown;
  errors?: Array<{ message: string; code?: string }>;
  escapeTarget?: string;
  versionExitCode?: number;
  echo?: boolean;
}

async function fixture(config: StubConfig = {}, clientConfig: Partial<DoclingCLIConfig> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "docling-correctness-"));
  directories.push(directory);
  const executable = join(directory, 'synthetic converter "quoted".mjs');
  await copyFile(resolve("tests/fixtures/cli-stub.mjs"), executable);
  await chmod(executable, 0o700);
  const log = join(directory, "invocations.jsonl");
  await writeFile(`${executable}.json`, JSON.stringify({ ...config, log }));
  const outputDir = join(directory, "outputs with spaces");
  const client = createCLIClient({
    doclingPath: executable,
    outputDir,
    timeout: 2000,
    ...clientConfig,
  });
  clients.push(client);
  const input = async (filename = "synthetic.pdf", content = "SYNTHETIC DOCUMENT\n") => {
    const path = join(directory, filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return path;
  };
  const invocations = async () => {
    try {
      return (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { argv: string[]; version: boolean; cwd: string; pid: number }
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  };
  return { client, directory, outputDir, executable, input, invocations };
}

function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value === null || value === undefined) throw new Error("Expected a test result");
  return value;
}

function sink() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, bytes: () => Buffer.concat(chunks) };
}

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Read ZIP central directory entries, including archives that use data descriptors.
function unzip(bytes: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
    const compression = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extraSize = bytes.readUInt16LE(offset + 30);
    const commentSize = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameSize);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + size);
    files[name] = (compression === 8 ? inflateRawSync(data) : data).toString("utf8");
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return files;
}

describe("main CLI conversion correctness at the public boundary", () => {
  it.each([
    "$(printf DOCLING_REVIEW_LITERAL).pdf",
    "a spaced \"double\" and 'single' `literal` $HOME.pdf",
  ])("passes literal input and option argv: %s", async (filename) => {
    const f = await fixture();
    const original = await f.input(filename, "literal-content");
    const headers = 'X-Test: spaces "quotes" $(printf NEVER) `literal` $HOME';
    const result = await f.client.convert(original, filename, { to_formats: ["md"], headers });
    expect(result.status).toBe("success");
    expect(result.document.md_content).toBe("literal-content");
    const calls = (await f.invocations()).filter((call) => !call.version);
    expect(calls).toHaveLength(1);
    const args = required(calls[0]).argv;
    expect(basename(required(args[0]))).toBe(filename);
    expect(args[0]).not.toBe(original); // private snapshot, with the exact literal basename
    expect(args[args.indexOf("--headers") + 1]).toBe(headers);
    expect(args[args.indexOf("--output") + 1]).toContain(f.outputDir);
    expect(f.client.getConfig().outputDir).toBe(f.outputDir);
    await expect(stat(required(args[0]))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(original, "utf8")).toBe("literal-content");
  });

  it("resolves a relative executable before changing to the job working directory", async () => {
    const f = await fixture();
    f.client.updateConfig({ doclingPath: relative(process.cwd(), f.executable) });
    const result = await f.client.convert(Buffer.from("relative executable"), "relative.pdf", {
      to_formats: ["md"],
    });
    expect(result.document.md_content).toBe("relative executable");
    expect(result.status).toBe("success");
  });

  it("keeps public executeCommand arguments literal", async () => {
    const f = await fixture({ echo: true });
    const args = ['space "quote" $(printf LITERAL) `literal` $HOME', "second"];
    const result = await f.client.executeCommand(args);
    expect(JSON.parse(result.stdout)).toEqual(args);
    expect(result.exitCode).toBe(0);
  });

  it("discovers a Python module using an executable path with spaces and prefix argv", async () => {
    const f = await fixture();
    const module = `docling_missing_module_${basename(f.directory).replace(/\W/g, "_")}`;
    f.client.updateConfig({ doclingPath: module, pythonPath: f.executable });
    const result = await f.client.convert(Buffer.from("module-content"), "module file.pdf", {
      to_formats: ["md"],
    });
    expect(result.document.md_content).toBe("module-content");
    const calls = await f.invocations();
    expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
      ["-m", module],
      ["-m", module],
    ]);
    expect(required(calls[0]).argv).toEqual(["-m", module, "--version"]);
  });

  it("rejects unavailable readiness and never emits ready", async () => {
    const f = await fixture();
    f.client.updateConfig({
      doclingPath: join(f.directory, "missing executable"),
      pythonPath: join(f.directory, "missing python"),
    });
    const ready = vi.fn();
    f.client.progress.on("initialized", ready);
    expect(await f.client.checkAvailability()).toBe(false);
    await expect(f.client.initialize()).rejects.toMatchObject({ code: "ENOENT" });
    await expect(f.client.convert(Buffer.from("x"), "x.pdf")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(ready).not.toHaveBeenCalled();
    expect(await f.invocations()).toEqual([]);
  });

  it("rejects an unsuccessful version probe", async () => {
    const f = await fixture({ versionExitCode: 7 });
    const ready = vi.fn();
    f.client.progress.on("initialized", ready);
    await expect(f.client.convert(Buffer.from("x"), "x.pdf")).rejects.toMatchObject({
      exitCode: 7,
    });
    expect(ready).not.toHaveBeenCalled();
    expect(await f.invocations()).toHaveLength(1);
  });

  it.each(["nonzero", "none", "write-then-fail"])(
    "reports failure for %s and cleans artifacts without retrying",
    async (behavior) => {
      const f = await fixture({ behavior });
      const complete = vi.fn();
      const formatComplete = vi.fn();
      f.client.progress.on("multi-format-complete", complete);
      f.client.progress.on("format-processing-complete", formatComplete);
      const result = await f.client.convert(Buffer.from("x"), "failed.pdf", { to_formats: ["md"] });
      expect(result.status).toBe("failure");
      expect(result.document.md_content).toBeUndefined();
      expect(result.errors).toHaveLength(1);
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          status: "failure",
          processedFormats: 0,
          outputFiles: {},
        })
      );
      expect(formatComplete).not.toHaveBeenCalled();
      expect((await f.invocations()).filter((call) => !call.version)).toHaveLength(1);
      expect(await readdir(f.outputDir)).toEqual([]);
    }
  );

  it.each(["nonzero", "none", "invalid-json"])(
    "returns partial_success and only validated content when a format has %s output",
    async (behavior) => {
      const f = await fixture({ formats: { json: behavior } });
      const complete = vi.fn();
      const fileRead = vi.fn();
      f.client.progress.on("multi-format-complete", complete);
      f.client.progress.on("file-read", fileRead);
      const result = await f.client.convert(Buffer.from("mixed-content"), "mixed.pdf", {
        to_formats: ["md", "json"],
      });
      expect(result.status).toBe("partial_success");
      expect(result.document.md_content).toBe("mixed-content");
      expect(result.document.json_content).toBeUndefined();
      expect(result.errors?.[0]?.message).toContain("json:");
      expect(fileRead).toHaveBeenCalledTimes(1);
      const event = required(complete.mock.calls[0])[0];
      expect(event).toMatchObject({
        status: "partial_success",
        success: false,
        processedFormats: 1,
      });
      expect(Object.keys(event.outputFiles)).toEqual(["md"]);
      expect(await readFile(event.outputFiles.md, "utf8")).toBe("mixed-content");
      expect(await readdir(dirname(dirname(event.outputFiles.md)))).toEqual(["format-0"]);
    }
  );

  it("cleans a private job when creating its input snapshot fails", async () => {
    const f = await fixture();
    await expect(
      f.client.convert(join(f.directory, "missing.pdf"), "missing.pdf", { to_formats: ["md"] })
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect((await f.invocations()).filter((call) => !call.version)).toHaveLength(0);
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it.each(["nonzero", "none", "invalid-json"])(
    "continues later formats after an ordinary %s failure",
    async (behavior) => {
      const f = await fixture({ formats: { json: behavior } });
      const result = await f.client.convert(Buffer.from("later format"), "mixed.pdf", {
        to_formats: ["json", "md"],
      });
      expect(result).toMatchObject({
        status: "partial_success",
        document: { md_content: "later format" },
        errors: [expect.objectContaining({ code: "CLI_FORMAT_FAILED" })],
      });
      expect(result.document.json_content).toBeUndefined();
      const calls = (await f.invocations()).filter((call) => !call.version);
      expect(calls.map((call) => call.argv[call.argv.indexOf("--to") + 1])).toEqual(["json", "md"]);
      expect(await readdir(required(calls[0]).cwd)).toEqual(["format-1"]);
    }
  );

  it("rejects an empty requested-format set instead of returning success", async () => {
    const f = await fixture();
    await expect(
      f.client.convert(Buffer.from("x"), "empty.pdf", { to_formats: [] })
    ).rejects.toThrow("At least one output format");
    expect((await f.invocations()).filter((call) => !call.version)).toHaveLength(0);
  });

  it.each(["text", "md"] as const)("preserves a valid empty %s export", async (format) => {
    const f = await fixture({ behavior: "empty" });
    const result = await f.client.convert(Buffer.from(""), "empty.pdf", { to_formats: [format] });
    expect(result.status).toBe("success");
    expect(format === "text" ? result.document.text_content : result.document.md_content).toBe("");
    expect(result.errors).toBeUndefined();
  });

  it.each(["empty", "invalid-json", "wrong-json"])(
    "rejects %s structured JSON output",
    async (behavior) => {
      const f = await fixture({ behavior });
      const result = await f.client.convert(Buffer.from("x"), "json.pdf", { to_formats: ["json"] });
      expect(result.status).toBe("failure");
      expect(result.document.json_content).toBeUndefined();
      expect(result.errors).toHaveLength(1);
    }
  );

  it("rejects a JSON object whose document fields have the wrong shape", async () => {
    const f = await fixture({
      behavior: "wrong-json",
      jsonValue: { name: "invalid", main_text: "not an array" },
    });
    const result = await f.client.convert(Buffer.from("x"), "invalid.pdf", {
      to_formats: ["json"],
    });
    expect(result.status).toBe("failure");
    expect(result.errors?.[0]?.message).toContain("main_text");
  });

  it("rejects an empty HTML file", async () => {
    const f = await fixture({ behavior: "empty" });
    const result = await f.client.convert(Buffer.from("x"), "empty.pdf", { to_formats: ["html"] });
    expect(result.status).toBe("failure");
    expect(result.document.html_content).toBeUndefined();
  });

  it("returns structured JSON as a document object, including a valid empty document", async () => {
    const f = await fixture();
    const result = await f.client.convert(Buffer.from(""), "json.pdf", { to_formats: ["json"] });
    expect(result.status).toBe("success");
    expect(result.document.json_content).toEqual({ name: "json", main_text: [], description: "" });
  });

  it("preserves upstream partial status, errors and warnings without claiming page completeness", async () => {
    const errors = [
      { message: "Upstream could not convert an element", code: "SYNTHETIC_PARTIAL" },
    ];
    const f = await fixture({ status: "partial_success", errors });
    const warning = vi.fn();
    const complete = vi.fn();
    f.client.progress.on("processing-warning", warning);
    f.client.progress.on("multi-format-complete", complete);
    const result = await f.client.convert(Buffer.from("partial"), "partial.pdf", {
      to_formats: ["md"],
    });
    expect(result).toMatchObject({
      status: "partial_success",
      errors,
      document: { md_content: "partial" },
    });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, status: "partial_success" })
    );
  });

  it("preserves partial status supplied in structured JSON output", async () => {
    const f = await fixture({ jsonStatus: "partial_success" });
    const result = await f.client.convert(Buffer.from("x"), "partial.pdf", {
      to_formats: ["json"],
    });
    expect(result.status).toBe("partial_success");
    expect(result.document.json_content?.name).toBe("partial");
    expect(result.errors?.[0]?.code).toBe("CLI_PARTIAL_SUCCESS");
  });

  it("does not expose content from an explicit upstream failure", async () => {
    const f = await fixture({ status: "failure", errors: [{ message: "Upstream failed" }] });
    const result = await f.client.convert(Buffer.from("x"), "failure.pdf", { to_formats: ["md"] });
    expect(result.status).toBe("failure");
    expect(result.document.md_content).toBeUndefined();
    expect(result.errors).toContainEqual({ message: "Upstream failed" });
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("never reuses stale basename or generic files, including a generic file in the new job", async () => {
    const f = await fixture({ behavior: "generic" });
    await mkdir(f.outputDir);
    await writeFile(join(f.outputDir, "output.md"), "stale generic");
    await writeFile(join(f.outputDir, "fresh.md"), "stale basename");
    const result = await f.client.convert(Buffer.from("new"), "fresh.pdf", { to_formats: ["md"] });
    expect(result.status).toBe("failure");
    expect(result.document.md_content).toBeUndefined();
    expect(await readdir(f.outputDir)).toEqual(["fresh.md", "output.md"]);
    expect(await readFile(join(f.outputDir, "output.md"), "utf8")).toBe("stale generic");
  });

  it("isolates concurrent same-basename inputs, outputs, settings and progress", async () => {
    const f = await fixture({ delay: 80 });
    const a = await f.input("first/same.pdf", "first input");
    const b = await f.input("second/same.pdf", "second input");
    const complete = vi.fn();
    const progress = vi.fn();
    f.client.progress.on("multi-format-complete", complete);
    f.client.progress.on("enhanced-progress", progress);
    const [first, second] = await Promise.all([
      f.client.convert(a, "same.pdf", { to_formats: ["md"] }),
      f.client.convert(b, "same.pdf", { to_formats: ["md", "json"] }),
    ]);
    expect(first.document.md_content).toBe("first input");
    expect(second.document.md_content).toBe("second input");
    expect(second.document.json_content?.description).toBe("second input");
    expect(complete.mock.calls.map(([event]) => event.totalFormats).sort()).toEqual([1, 2]);
    expect(new Set(complete.mock.calls.map(([event]) => event.jobId)).size).toBe(2);
    for (const [completion] of complete.mock.calls) {
      const updates = progress.mock.calls
        .map(([event]) => event)
        .filter((event) => event.jobId === completion.jobId);
      expect(updates[0]).toMatchObject({
        type: "start",
        totalFormats: completion.totalFormats,
        formatsCompleted: 0,
      });
      expect(updates.at(-1)).toMatchObject({
        type: "complete",
        totalFormats: completion.totalFormats,
        formatsCompleted: completion.totalFormats,
      });
    }
    const invocations = (await f.invocations()).filter((call) => !call.version);
    expect(new Set(invocations.map((call) => call.cwd)).size).toBe(2);
    expect(f.client.getConfig().outputDir).toBe(f.outputDir);
  });

  it("uses the same snapshot across formats even if the caller changes its source", async () => {
    const f = await fixture();
    const source = await f.input("snapshot.pdf", "before mutation");
    let mutation: Promise<void> | undefined;
    f.client.progress.on("format-processing-complete", () => {
      mutation = writeFile(source, "after mutation");
    });
    const result = await f.client.convert(source, "snapshot.pdf", { to_formats: ["md", "text"] });
    await mutation;
    expect(result.document.md_content).toBe("before mutation");
    expect(result.document.text_content).toBe("before mutation");
  });

  it.each(["../escape.pdf", "nested/escape.pdf", "nested\\escape.pdf", "..", "bad\0.pdf"])(
    "rejects traversal filename %j before conversion",
    async (filename) => {
      const f = await fixture();
      await expect(
        f.client.convert(Buffer.from("x"), filename, { to_formats: ["md"] })
      ).rejects.toThrow("single path component");
      expect((await f.invocations()).filter((call) => !call.version)).toEqual([]);
    }
  );

  it.each(["symlink", "directory-symlink"])(
    "rejects %s outputs without reading or deleting external content",
    async (behavior) => {
      const f = await fixture();
      const outside = join(f.directory, "outside");
      await mkdir(outside);
      const sentinel = join(outside, "escape.md");
      await writeFile(sentinel, "private outside content");
      await writeFile(
        `${f.executable}.json`,
        JSON.stringify({
          behavior,
          escapeTarget: behavior === "symlink" ? sentinel : outside,
          log: join(f.directory, "invocations.jsonl"),
        })
      );
      const read = vi.fn();
      f.client.progress.on("file-read", read);
      const result = await f.client.convert(Buffer.from("x"), "escape.pdf", { to_formats: ["md"] });
      expect(result.status).toBe("failure");
      expect(result.document.md_content).toBeUndefined();
      expect(read).not.toHaveBeenCalled();
      expect(await readFile(sentinel, "utf8")).toBe("private outside content");
      expect(await readdir(f.outputDir)).toEqual([]);
    }
  );

  it("archives validated bytes from Buffer input and cleans the ZIP job", async () => {
    const f = await fixture();
    const result = await f.client.convertToFile(Buffer.from("zip payload"), 'zip "literal".pdf', {
      to_formats: ["md", "json"],
    });
    expect(result.success).toBe(true);
    expect(result.fileMetadata?.filename).toBe('zip "literal".zip');
    const files = unzip(await streamBytes(required(result.fileStream)));
    expect(files['zip "literal".md']).toBe("zip payload");
    expect(JSON.parse(required(files['zip "literal".json'])).description).toBe("zip payload");
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("does not return a successful ZIP for missing or mixed output", async () => {
    const f = await fixture({ formats: { json: "none" } });
    const result = await f.client.convertToFile(Buffer.from("x"), "zip.pdf", {
      to_formats: ["md", "json"],
    });
    expect(result.success).toBe(false);
    expect(result.fileStream).toBeUndefined();
    expect(result.error?.details).toBeDefined();
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it.each([false, true])(
    "streams validated %s ZIP/content and cleans the private job",
    async (zip) => {
      const f = await fixture();
      const input = await f.input('stream $(printf LITERAL) "quoted".pdf', "stream payload");
      const output = sink();
      const result = await f.client.convertToStream(
        { sources: [input], toFormats: ["md"] },
        output.stream,
        zip
      );
      expect(result.success).toBe(true);
      expect(zip ? Object.values(unzip(output.bytes())) : [output.bytes().toString()]).toEqual([
        "stream payload",
      ]);
      expect(await readdir(f.outputDir)).toEqual([]);
      expect(await readFile(input, "utf8")).toBe("stream payload");
    }
  );

  it.each([false, true])("does not stream files when the process fails (ZIP=%s)", async (zip) => {
    const f = await fixture({ behavior: "write-then-fail" });
    const input = await f.input();
    const output = sink();
    const result = await f.client.convertToStream(
      { sources: [input], toFormats: ["md"] },
      output.stream,
      zip
    );
    expect(result).toMatchObject({ success: false, exitCode: 9, outputFiles: [] });
    expect(output.bytes().length).toBe(0);
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("validates progress output and preserves the returned private file paths", async () => {
    const f = await fixture();
    const input = await f.input('progress "quoted".pdf', "progress payload");
    const progress = vi.fn();
    const result = await f.client.convertWithProgress(
      { sources: [input], toFormats: ["md"] },
      progress
    );
    expect(result.success).toBe(true);
    expect(result.outputs?.markdown).toBe("progress payload");
    expect(result.outputFiles).toHaveLength(1);
    expect(await readFile(required(result.outputFiles?.[0]), "utf8")).toBe("progress payload");
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "completed" }));
    const call = required((await f.invocations()).find((invocation) => !invocation.version));
    await expect(stat(required(call.argv.at(-1)))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports progress failure for empty output", async () => {
    const f = await fixture({ behavior: "none" });
    const progress = vi.fn();
    const result = await f.client.convertWithProgress(
      { sources: [await f.input()], toFormats: ["md"] },
      progress
    );
    expect(result.success).toBe(false);
    expect(result.outputFiles).toEqual([]);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "failed" }));
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("does not retry timeouts or label a terminated process successful", async () => {
    const f = await fixture({ behavior: "timeout" }, { timeout: 1000 });
    const result = await f.client.convert(Buffer.from("x"), "timeout.pdf", { to_formats: ["md"] });
    expect(result.status).toBe("failure");
    expect(result.errors?.[0]?.details).toMatchObject({ name: "ProcessTimeoutError" });
    expect((await f.invocations()).filter((call) => !call.version)).toHaveLength(1);
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it
    .skipIf(process.platform === "win32")
    .each(
      (["SIGINT", "SIGTERM"] as const).flatMap((signal) =>
        (
          [
            "document-formats",
            "progress-after-success",
            "progress-sources",
            "stream-sources",
            "batch-sequential",
            "batch-parallel-queued",
            "batch-parallel-siblings",
            "batch-sequential-after-success",
            "batch-parallel-siblings-after-success",
            "directory",
          ] as const
        ).map((scenario) => ({ signal, scenario }))
      )
    )("preserves parent $signal abort and cleans $scenario jobs", async ({ signal, scenario }) => {
    const afterSuccess = scenario === "progress-after-success";
    const batch = scenario.startsWith("batch");
    const directory = scenario === "directory";
    const siblings = scenario.includes("siblings") || directory;
    const preserveCompleted = batch && scenario.endsWith("after-success");
    const f = await fixture(
      afterSuccess
        ? { formats: { json: "parent-signal" } }
        : {
            behavior: "parent-signal",
            ...(preserveCompleted && {
              files: { "completed-first.pdf": "write", "completed-second.pdf": "write" },
            }),
            // Keep one sibling alive after the first abort reaches batch(). Its
            // process and job must be gone at settlement, including escalation.
            ...(siblings && { signalExitDelays: { "second.pdf": 1000 } }),
          },
      { timeout: 5000 }
    );
    const first = await f.input("first.pdf", "first payload");
    const second = await f.input("second.pdf", "second payload");
    const third = siblings ? await f.input("third.pdf", "third payload") : undefined;
    const completedInputs = preserveCompleted
      ? [await f.input("completed-first.pdf", "completed payload")]
      : [];
    if (preserveCompleted && siblings)
      completedInputs.push(await f.input("completed-second.pdf", "completed payload"));
    const harness = join(f.directory, "public-client-parent-signal.mjs");
    const indexUrl = pathToFileURL(resolve("src/index.ts")).href;
    const runnerUrl = pathToFileURL(resolve("src/cli/process-runner.ts")).href;
    const options = {
      sources:
        batch || directory
          ? [...completedInputs, first, second, ...(third ? [third] : [])]
          : scenario.endsWith("sources")
            ? [first, second]
            : [first],
      toFormats:
        scenario === "progress-sources"
          ? ["md"]
          : afterSuccess
            ? ["md", "json", "html"]
            : ["md", "json"],
    };
    await writeFile(
      harness,
      `
        import { PassThrough, Writable } from "node:stream";
        import { readFile, readdir, stat } from "node:fs/promises";
        import { createCLIClient } from ${JSON.stringify(indexUrl)};
        import { ProcessAbortError } from ${JSON.stringify(runnerUrl)};
        const client = createCLIClient(${JSON.stringify({
          doclingPath: f.executable,
          outputDir: f.outputDir,
          timeout: 5000,
          concurrency: 2,
        })});
        const signals = ["SIGINT", "SIGTERM"];
        const before = signals.map(signal => process.listenerCount(signal));
        let completed = 0;
        let partial = 0;
        let written = 0;
        let batchCompleted = 0;
        const fileCompleted = [];
        const exposed = [];
        const stages = [];
        client.progress.on("stderr", ({ data }) => process.stdout.write(data));
        client.progress.on("multi-format-complete", ({ outputFiles }) => {
          completed++;
          exposed.push(...Object.values(outputFiles));
        });
        client.progress.on("batch-complete", () => batchCompleted++);
        client.progress.on("file-completed", ({ file }) => fileCompleted.push(file));
        client.progress.on("conversion-partial-failure", () => partial++);
        const options = ${JSON.stringify(options)};
        let outcome;
        try {
          if (${JSON.stringify(scenario)} === "document-formats") {
            await client.convert(${JSON.stringify(first)}, "first.pdf", { to_formats: options.toFormats });
          } else if (${batch}) {
            await client.batch(options.sources, {
              to_formats: ["md"],
              parallel: ${!scenario.includes("sequential")},
              maxConcurrency: ${siblings ? 2 : 1},
            });
          } else if (${directory}) {
            await client.processDirectory(${JSON.stringify(f.directory)}, { to_formats: ["md"] });
          } else if (${JSON.stringify(scenario)} === "stream-sources") {
            const output = new Writable({ write(chunk, _encoding, done) { written += chunk.length; done(); } });
            await client.convertToStream(options, output);
          } else {
            await client.convertWithProgress(options, progress => stages.push(progress.stage));
          }
          outcome = { kind: "resolved" };
        } catch (error) {
          outcome = { kind: "rejected", name: error.name, message: error.message, abort: error instanceof ProcessAbortError };
        }
        const clean = signals.every((signal, index) => before[index] === process.listenerCount(signal));
        const entries = await readdir(${JSON.stringify(f.outputDir)});
        const calls = (await readFile(${JSON.stringify(join(f.directory, "invocations.jsonl"))}, "utf8"))
          .trim().split("\\n").map(line => JSON.parse(line)).filter(call => !call.version);
        const aliveAtSettlement = calls.filter(call => {
          try { process.kill(call.pid, 0); return true; }
          catch (error) { if (error.code === "ESRCH") return false; throw error; }
        }).map(call => call.pid);
        const remainingJobs = [];
        for (const call of calls) {
          if (exposed.some(path => path.startsWith(call.cwd + "/"))) continue;
          try { await stat(call.cwd); remainingJobs.push(call.cwd); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        const exposedContents = await Promise.all(exposed.map(path => readFile(path, "utf8")));
        client.destroy();
        console.log("RESULT:" + JSON.stringify({ outcome, clean, entries, completed, partial, written, stages,
          batchCompleted, fileCompleted, exposed, exposedContents, aliveAtSettlement, remainingJobs }));
      `
    );
    let sent = false;
    let stdout = "";
    const converterPids = new Set<number>();
    try {
      const result = await runProcess(process.execPath, ["--import", "tsx", harness], {
        timeout: 12000,
        onStdout: (chunk) => {
          stdout += chunk;
          const ready = [...stdout.matchAll(/PARENT_SIGNAL_READY:(\d+):(\d+)\n/g)];
          for (const match of ready) converterPids.add(Number(match[2]));
          if (!sent && converterPids.size === (siblings ? 2 : 1)) {
            sent = true;
            process.kill(Number(required(ready[0]?.[1])), signal);
          }
        },
      });
      expect(sent).toBe(true);
      expect(result, result.stderr).toMatchObject({ success: true, exitCode: 0, signal: null });
      const outcome = JSON.parse(
        required(result.stdout.split("\n").find((line) => line.startsWith("RESULT:"))).slice(7)
      );
      expect(outcome).toMatchObject({
        outcome: {
          kind: "rejected",
          name: "ProcessAbortError",
          message: `Process interrupted by ${signal}`,
          abort: true,
        },
        clean: true,
        completed: completedInputs.length,
        partial: 0,
        written: 0,
        batchCompleted: 0,
        aliveAtSettlement: [],
        remainingJobs: [],
        exposedContents: completedInputs.map(() => "completed payload"),
      });
      expect(outcome.entries).toHaveLength(completedInputs.length);
      expect(outcome.fileCompleted.sort()).toEqual([...completedInputs].sort());
      if (scenario.startsWith("progress")) expect(outcome.stages.at(-1)).toBe("error");
      const calls = (await f.invocations()).filter((call) => !call.version);
      const expectedActive = siblings ? 2 : 1;
      expect(converterPids.size).toBe(expectedActive);
      expect(calls).toHaveLength(completedInputs.length + (afterSuccess ? 2 : expectedActive));
      expect(calls.map((call) => call.argv[call.argv.indexOf("--to") + 1])).toEqual(
        afterSuccess ? ["md", "json"] : calls.map(() => "md")
      );
      if (batch || directory)
        expect(calls.map((call) => basename(required(call.argv[0]))).sort()).toEqual(
          [
            ...completedInputs.map((path) => basename(path)),
            "first.pdf",
            ...(siblings ? ["second.pdf"] : []),
          ].sort()
        );
      for (const call of calls) {
        if (completedInputs.some((path) => basename(path) === basename(required(call.argv[0])))) {
          await expect(stat(join(call.cwd, "input-0"))).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          await expect(stat(call.cwd)).rejects.toMatchObject({ code: "ENOENT" });
        }
      }
      expect(await readdir(f.outputDir)).toHaveLength(completedInputs.length);
      for (const path of outcome.exposed)
        expect(await readFile(path, "utf8")).toBe("completed payload");
      expect(await readFile(first, "utf8")).toBe("first payload");
      expect(await readFile(second, "utf8")).toBe("second payload");
      if (third) expect(await readFile(third, "utf8")).toBe("third payload");
      for (const pid of converterPids) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      // The converter owns a separate process group from the harness. Also clean
      // it if a failed assertion or harness timeout interrupts this regression.
      for (const pid of converterPids) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch (error) {
          expect(error).toMatchObject({ code: "ESRCH" });
        }
      }
    }
  });

  it.each(["progress", "stream"] as const)(
    "applies the configured timeout to %s and cleans failed jobs",
    async (method) => {
      const f = await fixture({ behavior: "timeout" }, { timeout: 1000 });
      const options = { sources: [await f.input()], toFormats: ["md" as const] };
      const output = sink();
      const result =
        method === "progress"
          ? await f.client.convertWithProgress(options)
          : await f.client.convertToStream(options, output.stream);
      expect(result).toMatchObject({ success: false, exitCode: -1, outputFiles: [] });
      expect(result.error?.message).toContain("timed out");
      expect((await f.invocations()).filter((call) => !call.version)).toHaveLength(1);
      expect(output.bytes().length).toBe(0);
      expect(await readdir(f.outputDir)).toEqual([]);
    }
  );

  it("rejects destination write failures and still cleans stream jobs", async () => {
    const f = await fixture();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("synthetic destination failure"));
      },
    });
    await expect(
      f.client.convertToStream({ sources: [await f.input()], toFormats: ["md"] }, output)
    ).rejects.toThrow("synthetic destination failure");
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("does not coerce a signal exit into success in progress conversion", async () => {
    const f = await fixture({ behavior: "signal" });
    const result = await f.client.convertWithProgress({
      sources: [await f.input()],
      toFormats: ["md"],
    });
    expect(result).toMatchObject({ success: false, exitCode: -1, outputFiles: [] });
  });

  it.each(
    [
      { parallel: false, maxConcurrency: 1 },
      { parallel: true, maxConcurrency: 1 },
      { parallel: true, maxConcurrency: 2 },
    ].flatMap((mode) => ["nonzero", "missing-input"].map((failure) => ({ ...mode, failure })))
  )(
    "continues batch after an ordinary $failure failure (parallel=$parallel, concurrency=$maxConcurrency)",
    async ({ parallel, maxConcurrency, failure }) => {
      const f = await fixture({ files: { "failed.pdf": "nonzero" } });
      const failed =
        failure === "missing-input"
          ? join(f.directory, "missing.pdf")
          : await f.input("failed.pdf");
      const successful = await f.input("successful.pdf", "successful payload");
      const queued = await f.input("queued.pdf", "queued payload");
      const complete = vi.fn();
      const fileCompleted = vi.fn();
      f.client.progress.on("batch-complete", complete);
      f.client.progress.on("file-completed", fileCompleted);
      const result = await f.client.batch([failed, successful, queued], {
        to_formats: ["md"],
        parallel,
        maxConcurrency,
      });
      expect(result).toEqual({
        success: false,
        results: [
          { file: failed, success: false, error: expect.any(String) },
          { file: successful, success: true, output: "Converted successfully" },
          { file: queued, success: true, output: "Converted successfully" },
        ],
      });
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledWith({ total: 3, success: 2, failed: 1 });
      expect(fileCompleted).toHaveBeenCalledTimes(3);
      expect(
        (await f.invocations())
          .filter((call) => !call.version)
          .map((call) => basename(required(call.argv[0])))
          .sort()
      ).toEqual(
        [...(failure === "nonzero" ? ["failed.pdf"] : []), "successful.pdf", "queued.pdf"].sort()
      );
      expect(await readdir(f.outputDir)).toHaveLength(2);
    }
  );

  it("stops conversion when the destination closes before output validation", async () => {
    const f = await fixture({ delay: 100 });
    const input = await f.input();
    const error = new Error("destination disconnected");
    const output = sink();
    // Observe the error so the regression also runs safely before the fix.
    output.stream.on("error", vi.fn());
    f.client.progress.once("format-processing-start", () => {
      queueMicrotask(() => output.stream.destroy(error));
    });
    await expect(
      f.client.convertToStream({ sources: [input], toFormats: ["md", "json"] }, output.stream)
    ).rejects.toBe(error);
    expect((await f.invocations()).filter((call) => !call.version).length).toBeLessThanOrEqual(1);
    expect(output.bytes()).toHaveLength(0);
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("stops conversion when the destination finishes early", async () => {
    const f = await fixture({ delay: 100 });
    const output = sink();
    f.client.progress.once("format-processing-start", () => {
      queueMicrotask(() => output.stream.end());
    });
    await expect(
      f.client.convertToStream(
        { sources: [await f.input()], toFormats: ["md", "json"] },
        output.stream
      )
    ).rejects.toThrow("Destination finished before conversion completed");
    expect((await f.invocations()).filter((call) => !call.version).length).toBeLessThanOrEqual(1);
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("awaits destination finalization even when the converter produces no output", async () => {
    const f = await fixture({ behavior: "none" });
    const error = new Error("destination finalization failed");
    const output = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
      final(done) {
        done(error);
      },
    });
    output.on("error", vi.fn());
    await expect(
      f.client.convertToStream({ sources: [await f.input()], toFormats: ["md"] }, output)
    ).rejects.toBe(error);
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("rejects invalid input even when the destination suppresses close events", async () => {
    const f = await fixture();
    const output = new Writable({
      emitClose: false,
      write(_chunk, _encoding, done) {
        done();
      },
    });
    await expect(
      f.client.convertToStream({ sources: [], toFormats: ["md"] }, output)
    ).rejects.toThrow("Sources and output formats are required");
    expect(output.destroyed).toBe(true);
    expect(output.listenerCount("error")).toBe(0);
  });

  it("finishes the writable side of a duplex destination without awaiting its reader", async () => {
    const f = await fixture();
    const output = new PassThrough();
    try {
      const result = await f.client.convertToStream(
        { sources: [await f.input("duplex.pdf", "payload")], toFormats: ["md"] },
        output
      );
      expect(result.success).toBe(true);
      expect(output.readableEnded).toBe(false);
      expect(output.read()?.toString()).toBe("payload");
      expect(output.listenerCount("error")).toBe(0);
    } finally {
      output.destroy();
    }
  });

  it("cleans the job before notifying a throwing processing-error listener", async () => {
    const f = await fixture();
    const error = new Error("error observer failed");
    f.client.progress.on("processing-error", () => {
      throw error;
    });
    await expect(
      f.client.convert(join(f.directory, "missing.pdf"), "missing.pdf", { to_formats: ["md"] })
    ).rejects.toBe(error);
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "cleans downloaded inputs under a symlinked temp root",
    async () => {
      const f = await fixture();
      const physical = join(f.directory, "physical-temp");
      const alias = join(f.directory, "temp-alias");
      await mkdir(physical);
      await symlink(physical, alias, "dir");
      vi.stubEnv("TMPDIR", alias);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("downloaded input")));
      try {
        const result = await f.client.convertFromUrl("https://example.test/report.pdf", {
          to_formats: ["md"],
        });
        expect(result.status).toBe("success");
        expect(result.document.md_content).toBe("downloaded input");
        expect(await readdir(physical)).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
      }
    }
  );

  it("waits for sibling conversions before rejecting a multi-file progress callback", async () => {
    const f = await fixture({ delay: 100 });
    const error = new Error("progress callback failed");
    let converted = false;
    let notify!: () => void;
    const siblingComplete = new Promise<void>((resolveComplete) => {
      notify = resolveComplete;
    });
    f.client.progress.once("multi-format-complete", () => {
      converted = true;
      notify();
    });
    const operation = f.client.convertMultipleFiles(
      [
        { filename: "callback.pdf", buffer: Buffer.from("first") },
        { filename: "sibling.pdf", buffer: Buffer.from("second") },
      ],
      { to_formats: ["md"] },
      (progress) => {
        if (progress.filename === "callback.pdf") throw error;
      }
    );
    await expect(operation).rejects.toBe(error);
    const completeAtRejection = converted;
    await siblingComplete;
    expect(completeAtRejection).toBe(true);
  });

  it.each([false, true])(
    "honors batch outputDir without changing the client (parallel=%s)",
    async (parallel) => {
      const f = await fixture();
      const destination = join(f.directory, "batch-output");
      const completed: string[] = [];
      f.client.progress.on("file-read", ({ path }) => completed.push(path));
      const result = await f.client.batch([await f.input()], {
        outputDir: destination,
        parallel,
        to_formats: ["md"],
      });
      expect(result.success).toBe(true);
      expect(completed).toHaveLength(1);
      expect(relative(destination, required(completed[0]))).not.toMatch(/^\.\./);
      expect(f.client.getConfig().outputDir).toBe(f.outputDir);
    }
  );

  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, 0])(
    "rejects invalid batch concurrency %s before launching work",
    async (maxConcurrency) => {
      const f = await fixture();
      await expect(f.client.batch([await f.input()], { maxConcurrency })).rejects.toThrow(
        "positive safe integer"
      );
      expect(await f.invocations()).toEqual([]);
    }
  );

  it.each(["document", "progress", "zip"] as const)(
    "supports split-page HTML through %s conversion",
    async (method) => {
      const f = await fixture();
      const input = await f.input("split.pdf", "split payload");
      let html: string | null | undefined;
      if (method === "document") {
        const result = await f.client.convert(input, "split.pdf", {
          to_formats: ["html_split_page"],
        });
        expect(result.status).toBe("success");
        html = result.document.html_content;
      } else if (method === "progress") {
        const result = await f.client.convertWithProgress({
          sources: [input],
          toFormats: ["html_split_page"],
        });
        expect(result.success).toBe(true);
        expect(result.outputFiles?.[0]).toMatch(/split\.html$/);
        html = result.outputs?.html;
      } else {
        const output = sink();
        const result = await f.client.convertToStream(
          { sources: [input], toFormats: ["html_split_page"] },
          output.stream,
          true
        );
        expect(result.success).toBe(true);
        html = unzip(output.bytes())["split.html"];
      }
      expect(html).toBe('<html data-style="split-page"><body>split payload</body></html>');
      const calls = (await f.invocations()).filter((call) => !call.version);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.argv).toContain("html_split_page");
    }
  );

  it("keeps ordinary and split-page HTML distinct in one ZIP", async () => {
    const f = await fixture();
    const result = await f.client.convertToFile(Buffer.from("payload"), "split.pdf", {
      to_formats: ["html", "html_split_page"],
    });
    expect(result.success).toBe(true);
    const files = unzip(await streamBytes(required(result.fileStream)));
    expect(Object.values(files).sort()).toEqual(
      [
        "<html><body>payload</body></html>",
        '<html data-style="split-page"><body>payload</body></html>',
      ].sort()
    );
    expect(Object.keys(files)).toHaveLength(2);
    expect(await readdir(f.outputDir)).toEqual([]);
  });

  it("keeps async and batch success flags consistent with conversion status", async () => {
    const f = await fixture({ behavior: "none" });
    const asyncComplete = vi.fn();
    f.client.progress.on("async-complete", asyncComplete);
    expect(
      (await f.client.convertAsync(Buffer.from("x"), "async.pdf", { to_formats: ["md"] })).status
    ).toBe("failure");
    expect(asyncComplete).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, status: "failure" })
    );
    const options: ConversionOptions = { to_formats: ["md"] };
    const batch = await f.client.batch([await f.input()], options);
    expect(batch.success).toBe(false);
    expect(batch.results[0]?.success).toBe(false);
    expect(
      (
        await f.client.convertMultipleFiles(
          [{ buffer: Buffer.from("x"), filename: "multiple.pdf" }],
          options
        )
      ).success
    ).toBe(false);
  });
});
