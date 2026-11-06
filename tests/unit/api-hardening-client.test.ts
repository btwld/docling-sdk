import { File as NodeFile } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoclingAPIClient } from "../../src/clients/api-client";
import type { ConvertDocumentsRequest } from "../../src/types/api";
import type { DoclingAPIConfig } from "../../src/types/client";
import {
  loopback,
  readNodeStream,
  type ReceivedRequest,
  type Reply,
} from "./api-hardening-fixture";

const document = {
  document: { filename: "converted.pdf", md_content: "# Converted" },
  status: "success",
  processing_time: 1,
};
const zip = Buffer.from("PK local fixture bytes");
const zipReply = {
  body: zip,
  headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="converted.zip"',
  },
};
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup())
  );
});
async function fixture(
  respond: (request: ReceivedRequest) => Reply | Promise<Reply> = () => ({ body: document }),
  config: Partial<DoclingAPIConfig> = {}
) {
  const server = await loopback(respond);
  const client = new DoclingAPIClient({
    type: "api",
    baseUrl: server.baseUrl,
    retries: 0,
    timeout: 1000,
    ...config,
  });
  cleanups.push(server.close, () => client.destroy());
  return { ...server, client };
}
async function inputFile() {
  const directory = await mkdtemp(join(tmpdir(), "api-hardening-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "source.pdf");
  await writeFile(path, "input bytes");
  return path;
}

describe("API client public conversions", () => {
  it.each([
    "convert",
    "extractText",
    "toHtml",
    "toMarkdown",
    "convertDocument",
    "process",
    "convertSync",
  ] as const)("%s preserves client defaults and per-request overrides", async (method) => {
    const { client, requests } = await fixture(undefined, {
      apiKey: "test-key",
      headers: { "x-api-key": "header-key" },
      ocr_engine: "easyocr",
      pipeline: "standard",
      accelerator_options: { device: "cpu", num_threads: 2 },
      layout_options: { create_orphan_clusters: false },
      defaultOptions: { do_ocr: true, to_formats: ["json"] },
    });
    expect(
      await client[method](Buffer.from("input bytes"), "source.pdf", { do_ocr: false })
    ).toEqual(document);
    expect(requests[0]?.url).toBe("/v1/convert/file");
    expect(requests[0]?.headers["x-api-key"]).toBe("header-key");
    const form = await requests[0]!.form();
    const expectedFormats = { extractText: "text", toHtml: "html", toMarkdown: "md" };
    expect(form.getAll("to_formats")).toEqual([
      expectedFormats[method as keyof typeof expectedFormats] ?? "json",
    ]);
    expect(form.get("do_ocr")).toBe("false");
    expect(form.get("ocr_engine")).toBe("easyocr");
    expect(form.get("pipeline")).toBe("standard");
    expect(JSON.parse(String(form.get("accelerator_options")))).toEqual({
      device: "cpu",
      num_threads: 2,
    });
    expect(JSON.parse(String(form.get("layout_options")))).toEqual({
      create_orphan_clusters: false,
    });
    expect(await (form.get("files") as File).text()).toBe("input bytes");
  });

  it.each([
    "convertFromBuffer",
    "convertFromBase64",
    "convertFromFile",
    "convertFromUrl",
    "convertFromS3",
  ] as const)("%s serializes sources and options at the HTTP boundary", async (method) => {
    const { client, requests } = await fixture(undefined, {
      defaultOptions: { to_formats: ["md"] },
    });
    if (method === "convertFromBuffer")
      await client.convertFromBuffer(Buffer.from("input bytes"), "input.pdf");
    else if (method === "convertFromBase64")
      await client.convertFromBase64(Buffer.from("input bytes").toString("base64"), "input.pdf");
    else if (method === "convertFromFile") await client.convertFromFile(await inputFile());
    else if (method === "convertFromUrl")
      await client.convertFromUrl(
        "https://example.test/input.pdf",
        {},
        { Authorization: "fixture" }
      );
    else
      await client.convertFromS3({
        bucket: "input",
        key: "input.pdf",
        endpoint: "storage.test",
        access_key_id: "fixture-access",
        secret_access_key: "fixture-secret",
      });
    const request = requests[0]!;
    if (method === "convertFromUrl" || method === "convertFromS3") {
      expect(request.url).toBe("/v1/convert/source");
      expect(request.json()).toMatchObject({
        options: { to_formats: ["md"] },
        target: { kind: "inbody" },
      });
      const sources = (request.json() as ConvertDocumentsRequest).sources;
      expect(sources[0]).toMatchObject(
        method === "convertFromUrl"
          ? {
              kind: "http",
              url: "https://example.test/input.pdf",
              headers: { Authorization: "fixture" },
            }
          : { kind: "s3", bucket: "input", key_prefix: "input.pdf" }
      );
    } else {
      const form = await request.form();
      expect(await (form.get("files") as File).text()).toBe("input bytes");
      expect(form.get("to_formats")).toBe("md");
    }
  });

  it("accepts browser File values and explicit filenames on binary arrays", async () => {
    const { client, requests } = await fixture();
    await client.convertFile({
      files: [
        new NodeFile(["browser bytes"], "browser.pdf", { type: "application/pdf" }),
        new NodeFile(["unknown"], "unknown"),
      ] as unknown as globalThis.File[],
    });
    await client.convertFile({
      files: [Buffer.from("one"), Buffer.from("two")],
      filename: ["first.md", "second.md"],
      from_formats: ["md"],
    });
    const first = await requests[0]!.form();
    expect((first.getAll("files") as File[]).map((file) => [file.name, file.type])).toEqual([
      ["browser.pdf", "application/pdf"],
      ["unknown", "application/octet-stream"],
    ]);
    const second = await requests[1]!.form();
    expect((second.getAll("files") as File[]).map((file) => file.name)).toEqual([
      "first.md",
      "second.md",
    ]);
  });

  it.each([
    { sources: [] },
    { sources: [{ kind: "http", url: "invalid" }] },
    { sources: [{ kind: "file", filename: "", base64_string: "YQ==" }] },
    {
      sources: [{ kind: "file", filename: "file.pdf", base64_string: "YQ==" }],
      options: { images_scale: -1 },
    },
  ])("rejects invalid conversion requests before HTTP", async (request) => {
    const { client, requests } = await fixture();
    await expect(client.convertSource(request as ConvertDocumentsRequest)).rejects.toBeDefined();
    expect(requests).toHaveLength(0);
  });

  it("rejects unsupported file input and invalid uploaded options", async () => {
    const { client, requests } = await fixture();
    await expect(
      client.convertFile({ files: "invalid" as unknown as Uint8Array })
    ).rejects.toMatchObject({ message: expect.stringContaining("Unsupported file type") });
    await expect(
      client.convertFileAsync({ files: Buffer.from("input"), images_scale: -1 })
    ).rejects.toBeDefined();
    expect(requests).toHaveLength(0);
  });

  it.each(["convertFromUrl", "convertFromS3"] as const)(
    "rejects presigned results from %s",
    async (method) => {
      const { client } = await fixture(() => ({ body: { url: "https://example.test/result" } }));
      const conversion =
        method === "convertFromUrl"
          ? client.convertFromUrl("https://example.test/input")
          : client.convertFromS3({
              bucket: "b",
              key: "k",
              endpoint: "storage.test",
              access_key_id: "fixture",
              secret_access_key: "fixture",
            });
      await expect(conversion).rejects.toThrow("Unexpected presigned URL");
    }
  );

  it("maps target S3 configuration, returns target failures and preserves explicit target", async () => {
    let respondWithDocument = false;
    const targetResult = {
      status: "success",
      processing_time: 1,
      url: "https://example.test/result",
    };
    const { client, requests } = await fixture(() => ({
      body: respondWithDocument ? document : targetResult,
    }));
    const s3 = {
      kind: "s3" as const,
      bucket: "b",
      key: "k",
      endpoint: "storage.test",
      access_key_id: "fixture",
      secret_access_key: "fixture",
    };
    expect(await client.convertWithTarget([s3], s3)).toEqual({ success: true, data: targetResult });
    expect(requests[0]?.json()).toMatchObject({
      sources: [{ kind: "s3", key_prefix: "k" }],
      target: { kind: "s3", key_prefix: "k" },
    });
    const target = { kind: "put" as const, presigned_url: "https://example.test/output" };
    await client.convertWithTarget(
      [{ kind: "file", filename: "input", base64_string: "YQ==" }],
      target
    );
    expect(requests[1]?.json()).toMatchObject({ target });
    respondWithDocument = true;
    expect(
      await client.convertWithTarget([{ kind: "http", url: "https://example.test/input" }], target)
    ).toMatchObject({
      success: false,
      error: { message: expect.stringContaining("Unexpected document") },
    });
  });

  it("downloads a sync ZIP and returns structured errors for failed downloads", async () => {
    let fail = false;
    const { client, requests } = await fixture(() =>
      fail ? { status: 422, body: { detail: "conversion failed" } } : zipReply
    );
    const result = await client.convertToFile("input bytes", "input.pdf", { to_formats: ["md"] });
    expect(result.success).toBe(true);
    expect(result.fileMetadata).toEqual({
      filename: "converted.zip",
      contentType: "application/zip",
      size: zip.length,
    });
    expect(await readNodeStream(result.fileStream)).toEqual(zip);
    expect((await requests[0]!.form()).get("target_type")).toBe("zip");
    fail = true;
    expect(await client.convertToFile(Buffer.from("input"), "input.pdf", {})).toMatchObject({
      success: false,
      error: { message: "conversion failed" },
    });
    expect(await client.getTaskResultFile("task-1")).toMatchObject({
      success: false,
      error: { message: "conversion failed" },
    });
  });

  it("rejects JSON disguised as a ZIP download", async () => {
    const { client } = await fixture();
    expect(await client.convertToFile("input bytes", "input.pdf", {})).toMatchObject({
      success: false,
    });
    expect(await client.getTaskResultFile("task-1")).toMatchObject({ success: false });
  });

  it.each([
    "convertFileWithPipeline",
    "convertStreamWithPipeline",
    "convertStreamDirect",
    "convertStream",
  ] as const)("%s sends the input and exposes upload completion", async (method) => {
    const { client, requests } = await fixture();
    const progress = vi.fn();
    let result;
    if (method === "convertFileWithPipeline")
      result = await client.convertFileWithPipeline(await inputFile(), {}, progress);
    else if (method === "convertStreamWithPipeline")
      result = await client.convertStreamWithPipeline(
        Readable.from(["input ", Buffer.from("bytes")]),
        "input.pdf",
        {},
        11,
        progress
      );
    else if (method === "convertStreamDirect")
      result = await client.convertStreamDirect(
        Readable.from(["input bytes"]),
        "input.pdf",
        "application/pdf",
        {},
        11,
        progress
      );
    else result = await client.convertStream(Readable.from(["input bytes"]), "input.pdf");
    expect(result).toEqual(document);
    expect(await ((await requests[0]!.form()).get("files") as File).text()).toBe("input bytes");
    if (method !== "convertStream")
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "completed", uploadedBytes: 11 })
      );
  });

  it.each(["convertFileWithPipeline", "convertStreamWithPipeline", "convertStreamDirect"] as const)(
    "%s rejects failures with operation context",
    async (method) => {
      const { client } = await fixture(() => ({ status: 422, body: { detail: "rejected" } }));
      const request =
        method === "convertFileWithPipeline"
          ? client.convertFileWithPipeline(await inputFile())
          : method === "convertStreamWithPipeline"
            ? client.convertStreamWithPipeline(Readable.from(["input"]), "input.pdf")
            : client.convertStreamDirect(Readable.from(["input"]), "input.pdf", "application/pdf");
      await expect(request).rejects.toThrow(/conversion failed: rejected/);
    }
  );

  it("processes mixed batch inputs with isolated file failures and ordered results", async () => {
    const { client } = await fixture();
    const progress = vi.fn();
    const result = await client.convertMultipleFiles(
      [
        { buffer: Buffer.from("one"), filename: "one.pdf" },
        { filePath: await inputFile(), filename: "two.pdf" },
        { stream: Readable.from(["three"]), filename: "three.pdf", size: 5 },
        { filename: "missing.pdf" },
      ],
      {},
      progress
    );
    expect(result.success).toBe(false);
    expect(result.results.map(({ filename, success }) => [filename, success])).toEqual([
      ["one.pdf", true],
      ["two.pdf", true],
      ["three.pdf", true],
      ["missing.pdf", false],
    ]);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: "completed", totalFiles: 4 })
    );
  });

  it("validates input inventories and reports safe conversion success/failure", async () => {
    const { client } = await fixture();
    expect(
      await client.validateFiles([
        { filename: "" },
        { filename: "empty.pdf", buffer: Buffer.alloc(0) },
        { filename: "odd.xyz", buffer: Buffer.from("data") },
        { filename: "valid.pdf", filePath: "/fixture.pdf" },
      ])
    ).toMatchObject({
      valid: false,
      results: [
        { valid: false },
        { valid: false, errors: ["File is empty"] },
        { valid: true, warnings: [expect.stringContaining("xyz")] },
        { valid: true },
      ],
    });
    expect(await client.safeConvert("input", "input.pdf")).toEqual({
      success: true,
      data: document,
    });
    const { client: failedClient } = await fixture(() => ({
      status: 422,
      body: { detail: "invalid" },
    }));
    expect(await failedClient.safeConvert("input", "input.pdf")).toMatchObject({
      success: false,
      error: { message: "invalid" },
    });
    const { client: zipClient } = await fixture(() => zipReply);
    const result = await zipClient.safeConvertToFile("input", "input.pdf", {});
    expect(result.success).toBe(true);
    if (result.success) expect(await readNodeStream(result.data.fileStream)).toEqual(zip);
  });
});
