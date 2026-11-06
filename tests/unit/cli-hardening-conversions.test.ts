import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCLIClient } from "../../src/cli-entry";
import type { ConversionOptions, ConvertDocumentResponse } from "../../src/types/api";
import type { DoclingCLIConfig } from "../../src/types/client";

const directories: string[] = [];
const clients: ReturnType<typeof createCLIClient>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clients.splice(0).forEach((client) => client.destroy());
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function fixture(
  stubConfig: Record<string, unknown> = {},
  config: Partial<DoclingCLIConfig> = {}
) {
  const directory = await mkdtemp(join(tmpdir(), "cli-hardening-"));
  directories.push(directory);
  const executable = join(directory, "converter.mjs");
  await copyFile(resolve("tests/fixtures/cli-stub.mjs"), executable);
  await chmod(executable, 0o700);
  const log = join(directory, "invocations.jsonl");
  await writeFile(`${executable}.json`, JSON.stringify({ ...stubConfig, log }));
  const outputDir = join(directory, "outputs");
  const client = createCLIClient({ doclingPath: executable, outputDir, timeout: 5000, ...config });
  clients.push(client);
  const input = join(directory, "original.pdf");
  await writeFile(input, "original payload");
  const commands: string[][] = [];
  client.progress.on("command-built", ({ args }) => commands.push(args));
  return { client, directory, executable, outputDir, input, log, commands };
}

const adapters = [
  "convert",
  "extractText",
  "toHtml",
  "toMarkdown",
  "convertDocument",
  "process",
  "convertSync",
  "convertAsync",
  "convertFromBuffer",
  "convertFromBase64",
  "convertFromFile",
  "convertStream",
] as const;
describe("CLI public input adapters and defaults", () => {
  it.each(adapters)("%s preserves actual payload and shared configuration", async (method) => {
    const f = await fixture(
      {},
      {
        ocr_engine: "rapidocr",
        pdf_backend: "dlparse_v4",
        table_mode: "fast",
        pipeline: "standard",
      }
    );
    const options: ConversionOptions = { to_formats: ["md"], do_ocr: false };
    const buffer = Buffer.from("original payload");
    let result: ConvertDocumentResponse;
    if (method === "convertFromFile") result = await f.client.convertFromFile(f.input, options);
    else if (method === "convertFromBuffer")
      result = await f.client.convertFromBuffer(buffer, "original.pdf", options);
    else if (method === "convertFromBase64")
      result = await f.client.convertFromBase64(buffer.toString("base64"), "original.pdf", options);
    else if (method === "convertStream")
      result = await f.client.convertStream(
        Readable.from(["original ", buffer.subarray(9)]),
        "original.pdf",
        options
      );
    else result = await f.client[method](buffer, "original.pdf", options);
    expect(result.status).toBe("success");
    const expectedFormat = method === "extractText" ? "text" : method === "toHtml" ? "html" : "md";
    const content =
      expectedFormat === "text"
        ? result.document.text_content
        : expectedFormat === "html"
          ? result.document.html_content
          : result.document.md_content;
    expect(content).toBe(
      expectedFormat === "html" ? "<html><body>original payload</body></html>" : "original payload"
    );
    const argumentsReceived = f.commands[0] || [];
    expect(argumentsReceived[argumentsReceived.indexOf("--to") + 1]).toBe(expectedFormat);
    expect(f.commands).toHaveLength(1);
    expect(f.commands[0]).toEqual(
      expect.arrayContaining([
        "--ocr-engine",
        "rapidocr",
        "--pdf-backend",
        "dlparse_v4",
        "--table-mode",
        "fast",
        "--no-ocr",
      ])
    );
    expect(await readFile(f.input, "utf8")).toBe("original payload");
    for (const directory of await readdir(f.outputDir))
      expect(await readdir(join(f.outputDir, directory))).not.toContain("input-0");
  });

  it("uses the configured output directory after both setters", async () => {
    const f = await fixture();
    const first = join(f.directory, "first-output");
    f.client.setOutputDir(first);
    expect(f.client.getConfig().outputDir).toBe(first);
    await f.client.toMarkdown(Buffer.from("first"), "first.pdf");
    expect(await readdir(first)).toHaveLength(1);
    const second = join(f.directory, "second-output");
    f.client.updateConfig({ outputDir: second });
    await f.client.toMarkdown(Buffer.from("second"), "second.pdf");
    expect(await readdir(second)).toHaveLength(1);
    expect(await readdir(first)).toHaveLength(1);
  });

  it("converts readable streams to ZIP and handles source failures", async () => {
    const f = await fixture();
    const result = await f.client.convertStreamToFile(
      Readable.from([Buffer.from("zipped payload")]),
      "stream.pdf",
      { to_formats: ["md"] }
    );
    expect(result.success).toBe(true);
    const chunks: Buffer[] = [];
    for await (const chunk of result.fileStream as AsyncIterable<Buffer>) chunks.push(chunk);
    expect(Buffer.concat(chunks).subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(result.fileMetadata?.filename).toBe("stream.zip");
    expect(await readdir(f.outputDir)).toEqual([]);
    const broken = () =>
      Readable.from(
        (async function* () {
          yield "before failure";
          throw new Error("source read failed");
        })()
      );
    await expect(f.client.convertStream(broken(), "bad.pdf")).rejects.toThrow("source read failed");
    expect(
      await f.client.convertStreamToFile(broken(), "bad.pdf", { to_formats: ["md"] })
    ).toMatchObject({
      success: false,
      error: { message: "Failed to process input stream to file", details: "source read failed" },
    });
  });

  it("returns safe conversion values for success and actual input failure", async () => {
    const f = await fixture();
    const success = await f.client.safeConvert(Buffer.from("safe"), "safe.pdf", {
      to_formats: ["md"],
    });
    expect(success.success).toBe(true);
    if (success.success) expect(success.data.document.md_content).toBe("safe");
    const missing = join(f.directory, "missing.pdf");
    expect((await f.client.safeConvert(missing, "missing.pdf")).success).toBe(false);
    const zip = await f.client.safeConvertToFile(Buffer.from("safe zip"), "safe.pdf", {
      to_formats: ["md"],
    });
    expect(zip.success).toBe(true);
    const failed = await f.client.safeConvertToFile(missing, "missing.pdf", { to_formats: ["md"] });
    expect(failed.success).toBe(true);
    if (failed.success) expect(failed.data.success).toBe(false);
  });

  it("validates real file kinds, extensions and missing paths", async () => {
    const f = await fixture();
    const folder = join(f.directory, "folder.pdf");
    await mkdir(folder);
    const unsupported = join(f.directory, "unknown.exe");
    const upper = join(f.directory, "upper.DOCX");
    await writeFile(unsupported, "unsupported");
    await writeFile(upper, "supported");
    const missing = join(f.directory, "absent.pdf");
    const result = await f.client.validateFiles([f.input, upper, folder, unsupported, missing]);
    expect(result.valid).toEqual([f.input, upper]);
    expect(result.invalid).toEqual([
      { file: folder, reason: "Not a file" },
      { file: unsupported, reason: "Unsupported file type: .exe" },
      { file: missing, reason: expect.stringContaining("ENOENT") },
    ]);
  });

  it("reports mixed multiple-file inputs and accurate progress", async () => {
    const f = await fixture();
    const progress = vi.fn();
    const result = await f.client.convertMultipleFiles(
      [
        { filename: "buffer.pdf", buffer: Buffer.from("buffer payload") },
        { filename: "path.pdf", filePath: f.input },
        { filename: "invalid.pdf" },
      ],
      { to_formats: ["md"] },
      progress
    );
    expect(result.success).toBe(false);
    expect(result.results.map((item) => item.success)).toEqual([true, true, false]);
    expect(result.results[0]?.result?.document.md_content).toBe("buffer payload");
    expect(result.results[1]?.result?.document.md_content).toBe("original payload");
    expect(result.results[2]?.error).toContain("Either buffer or filePath");
    expect(progress).toHaveBeenLastCalledWith({
      stage: "completed",
      currentFile: 3,
      totalFiles: 3,
      filename: "all files",
      percentage: 100,
    });
  });
});

it.each([
  "https://example.test/report.pdf?query=1",
  "https://example.test/download",
  "not a valid URL",
])("downloads URL input %s using the real conversion path", async (url) => {
  const f = await fixture();
  const fetch = vi.fn().mockResolvedValue(new Response("downloaded payload"));
  vi.stubGlobal("fetch", fetch);
  const result = await f.client.convertFromUrl(url, { to_formats: ["md"] });
  expect(result.status).toBe("success");
  expect(result.document.md_content).toBe("downloaded payload");
  expect(fetch).toHaveBeenCalledWith(
    url,
    expect.objectContaining({ signal: expect.any(AbortSignal) })
  );
});

it.each(["http", "missing-body", "read-error"])(
  "reports %s download failures before conversion",
  async (failure) => {
    const f = await fixture();
    const response =
      failure === "http"
        ? new Response("missing", { status: 404 })
        : failure === "missing-body"
          ? new Response(null)
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("network read failed"));
                },
              })
            );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(f.client.convertFromUrl("https://example.test/input.pdf")).rejects.toThrow(
      failure === "http"
        ? "HTTP 404"
        : failure === "missing-body"
          ? "No response body"
          : "network read failed"
    );
    expect(f.commands).toEqual([]);
  }
);

it.each([
  ["document_timeout", 0],
  ["document_timeout", 3601],
  ["document_timeout", Number.NaN],
  ["images_scale", Number.POSITIVE_INFINITY],
  ["images_scale", 0],
  ["num_threads", "many"],
  ["ocr_engine", "unknown"],
  ["pdf_backend", "pdfminer"],
  ["to_formats", ["invalid"]],
  ["page_range", [0, 2]],
  ["page_range", [3, 2]],
  ["page_range", [1, Number.NaN]],
  ["page_range", [1.5, 2]],
  ["quiet", true],
])("rejects invalid %s configuration before dispatch", async (name, value) => {
  const f = await fixture();
  const options = {
    [name as string]: value,
    ...(name === "quiet" ? { verbose: 1 } : {}),
  } as ConversionOptions;
  await expect(
    f.client.process(Buffer.from("original"), "original.pdf", options)
  ).rejects.toThrow();
  expect(f.commands).toEqual([]);
});

it("forwards supported Python options literally and allows all public OCR engines", async () => {
  const f = await fixture();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const options: ConversionOptions = {
    to_formats: ["md"],
    from_formats: ["pdf", "docx"],
    do_ocr: true,
    force_ocr: true,
    ocr_engine: "ocrmac",
    ocr_lang: ["en", "fr"],
    pdf_backend: "dlparse_v4",
    table_mode: "accurate",
    do_table_structure: true,
    do_code_enrichment: true,
    do_formula_enrichment: true,
    do_picture_classification: true,
    do_picture_description: true,
    pipeline: "standard",
    abort_on_error: false,
    document_timeout: 17,
    image_export_mode: "placeholder",
    enable_remote_services: true,
    allow_external_plugins: true,
    artifacts_path: "model assets literal '$(x)'",
  };
  const result = await f.client.convert(Buffer.from("options payload"), "options.pdf", options);
  expect(result.document.md_content).toBe("options payload");
  const args = f.commands[0];
  expect(args).toEqual(
    expect.arrayContaining([
      "--from",
      "pdf",
      "--from",
      "docx",
      "--ocr",
      "--force-ocr",
      "--ocr-engine",
      "ocrmac",
      "--ocr-lang",
      "en,fr",
      "--tables",
      "--enrich-code",
      "--enrich-formula",
      "--enrich-picture-classes",
      "--enrich-picture-description",
      "--no-abort-on-error",
      "--document-timeout",
      "17",
      "--image-export-mode",
      "placeholder",
      "--enable-remote-services",
      "--allow-external-plugins",
      "--artifacts-path",
      resolve("model assets literal '$(x)'"),
    ])
  );
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unrecognized OCR languages"));
  await f.client.convert(Buffer.from("disabled"), "disabled.pdf", {
    to_formats: ["md"],
    do_ocr: false,
    force_ocr: false,
    do_table_structure: false,
    do_code_enrichment: false,
    do_formula_enrichment: false,
    do_picture_classification: false,
    do_picture_description: false,
    abort_on_error: true,
    enable_remote_services: false,
    allow_external_plugins: false,
    ocr_lang: [],
  });
  expect(f.commands[1]).toEqual(
    expect.arrayContaining(["--no-ocr", "--no-tables", "--abort-on-error"])
  );
  expect(f.commands[1]).not.toContain("--force-ocr");
  expect(f.commands[1]).not.toContain("--enrich-code");
  await f.client.convert(Buffer.from("engine"), "engine.pdf", {
    to_formats: ["md"],
    do_ocr: false,
    ocr_engine: "tesserocr",
  });
  expect(f.commands[2]).toContain("tesserocr");
});

it.each(["production", "development"])(
  "retains environment defaults in %s",
  async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    const f = await fixture();
    await f.client.toMarkdown(Buffer.from("environment"), "environment.pdf");
    expect(f.commands[0]).toEqual(
      expect.arrayContaining([
        "--num-threads",
        environment === "production" ? "4" : "2",
        "--document-timeout",
        environment === "production" ? "300" : "600",
      ])
    );
    const verbose = f.commands[0]?.filter((arg) => arg === "--verbose").length;
    expect(verbose).toBe(environment === "production" ? 0 : 1);
  }
);

it("builds repeatable CLI formats, comma-separated languages and counted verbosity", () => {
  const client = createCLIClient();
  clients.push(client);
  expect(
    client.buildConvertArgs({
      sources: ["document.pdf"],
      fromFormats: ["pdf", "docx"],
      toFormats: ["md", "json"],
      ocr: false,
      ocrLang: ["en", "fr"],
      verbose: 2,
    })
  ).toEqual([
    "convert",
    "--from",
    "pdf",
    "--from",
    "docx",
    "--to",
    "md",
    "--to",
    "json",
    "--no-ocr",
    "--ocr-lang",
    "en,fr",
    "--verbose",
    "--verbose",
    "document.pdf",
  ]);
  for (const verbose of [-1, Number.NaN, Number.POSITIVE_INFINITY, 4, 0.5])
    expect(() => client.buildConvertArgs({ sources: ["x.pdf"], verbose })).toThrow("Verbose level");
  expect(client.buildConvertArgs({ sources: [], verbose: 0 })).toEqual(["convert"]);
});

it("keeps health and executable updates truthful", async () => {
  const f = await fixture();
  expect(await f.client.health()).toMatchObject({
    status: "available",
    version: "SYNTHETIC docling stub 1.0",
  });
  f.client.updateConfig({ doclingPath: join(f.directory, "missing") });
  expect(await f.client.health()).toEqual({ status: "unavailable" });
  f.client.updateConfig({ doclingPath: f.executable });
  expect((await f.client.toMarkdown(Buffer.from("updated"), "updated.pdf")).status).toBe("success");
});

it("keeps automatic progress callbacks isolated and reports conversion failures", async () => {
  const f = await fixture();
  const progress = vi.fn();
  const complete = vi.fn();
  const error = vi.fn();
  const result = await f.client.convertWithAutoProgress(
    { sources: [f.input], toFormats: ["md"] },
    { onProgress: progress, onComplete: complete, onError: error }
  );
  expect(result.success).toBe(true);
  expect(progress).toHaveBeenLastCalledWith(
    expect.objectContaining({ stage: "completed", percentage: 100, timestamp: expect.any(Number) })
  );
  expect(complete).toHaveBeenCalledWith(result);
  expect(error).not.toHaveBeenCalled();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const failure = new Error("observer failure");
  const throwing = () => {
    throw failure;
  };
  expect(
    (
      await f.client.convertWithAutoProgress(
        { sources: [f.input], toFormats: ["md"] },
        { onProgress: throwing, onComplete: throwing }
      )
    ).success
  ).toBe(true);
  expect(consoleError).toHaveBeenCalledWith("Error in progress callback:", failure);
  expect(consoleError).toHaveBeenCalledWith("Error in completion callback:", failure);
  await expect(
    f.client.convertWithAutoProgress({ sources: [], toFormats: ["md"] }, { onError: throwing })
  ).rejects.toThrow("Sources and output formats");
  expect(consoleError).toHaveBeenCalledWith("Error in error callback:", failure);
  expect(
    (await f.client.convertWithAutoProgress({ sources: [f.input], toFormats: ["md"] })).success
  ).toBe(true);
});

it("rejects interrupted multiple-file conversions after all started jobs clean up", async () => {
  const f = await fixture({ behavior: "parent-signal" });
  let interrupted = false;
  f.client.progress.on("stderr", ({ data }) => {
    if (data.includes("PARENT_SIGNAL_READY:") && !interrupted) {
      interrupted = true;
      process.emit("SIGTERM", "SIGTERM");
    }
  });
  await expect(
    f.client.convertMultipleFiles(
      [
        { filename: "first.pdf", buffer: Buffer.from("first") },
        { filename: "second.pdf", buffer: Buffer.from("second") },
      ],
      { to_formats: ["md"] }
    )
  ).rejects.toMatchObject({ name: "ProcessAbortError" });
  expect(interrupted).toBe(true);
  expect(await readdir(f.outputDir)).toEqual([]);
});

it("retains cancellation identity across the downloaded-input adapter", async () => {
  const f = await fixture({ behavior: "parent-signal" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("downloaded")));
  f.client.progress.once("stderr", () => process.emit("SIGINT", "SIGINT"));
  await expect(
    f.client.convertFromUrl("https://example.test/file.pdf", { to_formats: ["md"] })
  ).rejects.toMatchObject({ name: "ProcessAbortError" });
  expect(await readdir(f.outputDir)).toEqual([]);
});

it("rejects a malformed current document version field", async () => {
  const f = await fixture({ behavior: "wrong-json", jsonValue: { name: "broken", version: 42 } });
  const result = await f.client.convert(Buffer.from("version"), "version.pdf", {
    to_formats: ["json"],
  });
  expect(result.status).toBe("failure");
  expect(result.document.json_content).toBeUndefined();
  expect(result.errors?.[0]?.message).toContain("Invalid JSON document field: version");
});

it.skipIf(process.platform === "win32")(
  "reports actual destination-open failures without leaking a download stream",
  async () => {
    const f = await fixture();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("downloaded bytes")));
    await expect(
      f.client.convertFromUrl(`https://example.test/${"long".repeat(100)}.pdf`)
    ).rejects.toThrow("ENAMETOOLONG");
    expect(f.commands).toEqual([]);
  }
);

it("uses the converter's default OCR engine while honoring explicit and nested options", async () => {
  const f = await fixture();
  await f.client.convert(Buffer.from("default engine"), "default.pdf", { to_formats: ["md"] });
  expect(f.commands[0]).not.toContain("--ocr-engine");
  await f.client.convert(Buffer.from("nested options"), "nested.pdf", {
    to_formats: ["md"],
    accelerator_options: { device: "cpu", num_threads: 3 },
    ocr_options: { kind: "rapidocr", lang: ["eng", "fra"], force_full_page_ocr: true },
    table_structure_options: { mode: "fast" },
  });
  expect(f.commands[1]).toEqual(
    expect.arrayContaining([
      "--device",
      "cpu",
      "--num-threads",
      "3",
      "--ocr-engine",
      "rapidocr",
      "--ocr-lang",
      "eng,fra",
      "--force-ocr",
      "--table-mode",
      "fast",
    ])
  );
  expect(f.commands[1]).not.toContain("auto");
  await f.client.convert(Buffer.from("explicit options"), "explicit.pdf", {
    to_formats: ["md"],
    ocr_engine: "tesseract",
    ocr_lang: ["eng"],
    force_ocr: false,
    ocr_options: { kind: "rapidocr", lang: ["fra"], force_full_page_ocr: true },
    table_mode: "accurate",
    table_structure_options: { mode: "fast" },
  });
  expect(f.commands[2]).toEqual(
    expect.arrayContaining([
      "--ocr-engine",
      "tesseract",
      "--ocr-lang",
      "eng",
      "--table-mode",
      "accurate",
    ])
  );
  expect(f.commands[2]).not.toContain("rapidocr");
  expect(f.commands[2]).not.toContain("--force-ocr");
  await expect(
    f.client.convert(Buffer.from("invalid nested"), "invalid.pdf", {
      accelerator_options: { num_threads: 1.5 },
    })
  ).rejects.toThrow("Number of threads");
});
