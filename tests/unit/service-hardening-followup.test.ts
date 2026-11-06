// API/service follow-up regressions for review-api-findings.md (2026-11-06).
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoclingAPIClient } from "../../src/clients/api-client";
import * as detection from "../../src/platform/detection";
import type { ConversionOptions } from "../../src/types/api";
import { type ReceivedRequest, type Reply, loopback } from "./api-hardening-fixture";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture(respond: (request: ReceivedRequest) => Reply) {
  const server = await loopback(respond);
  const client = new DoclingAPIClient({ type: "api", baseUrl: server.baseUrl, retries: 0 });
  cleanups.push(server.close, () => client.destroy());
  return { ...server, client };
}
const schema = JSON.parse(
  readFileSync(new URL("../../openapi/docling-serve.json", import.meta.url), "utf8")
);
const chunks = { chunks: [], documents: [], processing_time: 1 };

// A valid empty ZIP archive, not a JSON document standing in for a ZIP result.
const zip = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]);
const zipReply = {
  body: zip,
  headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="real-result.zip"',
    "Content-Length": String(zip.byteLength),
  },
};

const methods = [
  "chunkHybridSync",
  "chunkHierarchicalSync",
  "chunkHybridAsync",
  "chunkHierarchicalAsync",
  "chunkHybridFileAsync",
  "chunkHierarchicalFileAsync",
] as const;

describe("chunk conversion option parity with pinned Serve forms", () => {
  it.each(methods)(
    "%s serializes missing supported options through the public client",
    async (method) => {
      const { client, requests } = await fixture((request) => {
        if (request.url.includes("/status/")) return { body: { task_status: "success" } };
        if (request.url.includes("/result/")) return { body: chunks };
        return { body: method.endsWith("Sync") ? chunks : { task_id: "chunk-task" } };
      });
      const local = method.includes("Hierarchical");
      const model = method.endsWith("Sync")
        ? { vlm_pipeline_model: "smoldocling" as const }
        : local
          ? {
              vlm_pipeline_model_local: {
                repo_id: "ibm-granite/granite-docling-258M",
                prompt: "Convert this page to docling.",
                scale: 2,
                response_format: "doctags" as const,
                inference_framework: "transformers" as const,
                transformers_model_type: "automodel-vision2seq" as const,
                extra_generation_config: { skip_special_tokens: false },
              },
            }
          : {
              vlm_pipeline_model_api: {
                url: "http://localhost:1234/v1/chat/completions",
                params: { model: "ibm-granite/granite-docling-258M-mlx" },
                timeout: 60,
                concurrency: 1,
                prompt: "Convert this page to docling.",
                scale: 2,
                response_format: "doctags" as const,
              },
            };
      const options = {
        from_formats: ["pdf", "image"],
        image_export_mode: "embedded",
        pipeline: "standard",
        do_ocr: false,
        force_ocr: true,
        ocr_engine: "easyocr",
        ocr_lang: ["en", "fr"],
        page_range: [1, 3],
        pdf_backend: "dlparse_v4",
        table_mode: "accurate",
        table_cell_matching: false,
        do_table_structure: false,
        include_images: false,
        images_scale: 0,
        do_code_enrichment: true,
        do_formula_enrichment: false,
        do_picture_classification: false,
        do_picture_description: true,
        picture_description_area_threshold: 0,
        md_page_break_placeholder: "",
        abort_on_error: false,
        document_timeout: 0,
        chunking_use_markdown_tables: true,
        chunking_include_raw_text: false,
        chunking_max_tokens: 256,
        chunking_tokenizer: "sentence-transformers/all-MiniLM-L6-v2",
        chunking_merge_peers: false,
        ...(local
          ? {
              picture_description_local: {
                repo_id: "HuggingFaceTB/SmolVLM-256M-Instruct",
                prompt: "Describe this image.",
                generation_config: { max_new_tokens: 200, do_sample: false },
              },
            }
          : {
              picture_description_api: {
                url: "http://localhost:1234/v1/chat/completions",
                headers: {},
                params: { model: "granite3.2-vision:2b" },
                timeout: 20,
                concurrency: 1,
                prompt: "Describe this image.",
              },
            }),
        ...model,
      } satisfies ConversionOptions;
      const input = new Uint8Array([1]);
      if (method === "chunkHybridFileAsync" || method === "chunkHierarchicalFileAsync") {
        const task = await client[method]({
          files: input,
          filename: "input.pdf",
          ...options,
          include_converted_doc: false,
        });
        expect(task.taskId).toBe("chunk-task");
        expect(await task.getResult()).toEqual(chunks);
      } else expect(await client[method](input, "input.pdf", options)).toEqual(chunks);

      const request = requests[0];
      if (!request) throw new Error("Missing upload request");
      const ref =
        schema.paths[request.url].post.requestBody.content["multipart/form-data"].schema.$ref;
      const properties = schema.components.schemas[ref.split("/").pop()].properties;
      const form = await request.form();
      for (const [key, value] of Object.entries(options)) {
        const wireKey = key.startsWith("chunking_") ? key : `convert_${key}`;
        expect(properties, `Pinned schema supports ${wireKey}`).toHaveProperty(wireKey);
        expect(form.getAll(wireKey), wireKey).toEqual(
          Array.isArray(value)
            ? value.map(String)
            : [typeof value === "object" ? JSON.stringify(value) : String(value)]
        );
      }
      expect(form.get("target_type")).toBe("inbody");
      if (method.includes("FileAsync")) expect(form.get("include_converted_doc")).toBe("false");
      expect((form.get("files") as File).name).toBe("input.pdf");
    }
  );

  it.each(["throw", "reject"] as const)(
    "retains chunk task monitoring errors when an error observer %s",
    async (mode) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { client } = await fixture(() => ({ body: { task_id: "chunk-task" } }));
      const task = await client.chunkHybridFileAsync({ files: new Uint8Array([1]) });
      const nextObserver = vi.fn();
      task.on("error", () => {
        if (mode === "throw") throw new Error("observer failed");
        return Promise.reject(new Error("observer failed"));
      });
      task.on("error", nextObserver);
      const waiting = task.waitForCompletion();
      const rejection = expect(waiting).rejects.toThrow("Task manager destroyed");
      client.destroy();
      await rejection;
      expect(nextObserver).toHaveBeenCalledWith({ message: "Task manager destroyed" });
    }
  );
});

describe("non-Node downloads preserve the existing byte-data contract", () => {
  it.each([
    "HTTP wrapper",
    "getTaskResultFile",
    "files.convertToFile",
    "files.convertToFileAsync",
    "convertStreamToFile",
  ] as const)(
    "%s returns ZIP bytes and metadata after reading the platform Web stream",
    async (entry) => {
      // Exercise non-Node branches while retaining the real HTTP transport and task manager.
      vi.spyOn(detection, "isNode").mockReturnValue(false);
      const { client, requests } = await fixture((request) => {
        if (request.url.includes("/status/")) return { body: { task_status: "success" } };
        if (request.url.includes("/result/")) return zipReply;
        return { body: { task_id: "zip-task" } };
      });
      const input = new Uint8Array([1]);
      const result =
        entry === "HTTP wrapper"
          ? await client.getHttpClient().requestFileStream("/v1/result/zip-task")
          : entry === "getTaskResultFile"
            ? await client.getTaskResultFile("zip-task")
            : entry === "files.convertToFile"
              ? await client.files.convertToFile(input, "input.pdf", {})
              : entry === "files.convertToFileAsync"
                ? await client.files.convertToFileAsync(input, "input.pdf", {})
                : await client.convertStreamToFile(Readable.from([input]), "input.pdf", {});
      if ("success" in result) expect(result.success).toBe(true);
      expect(result.fileStream).toBeUndefined();
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.data).toEqual(zip);
      expect(result.fileMetadata).toEqual({
        filename: "real-result.zip",
        contentType: "application/zip",
        size: zip.byteLength,
      });
      expect(requests.filter((request) => request.url.includes("/result/"))).toHaveLength(1);
    }
  );

  it("downloads an async ZIP task using getTaskResultFile without claiming getResult handles ZIP", async () => {
    vi.spyOn(detection, "isNode").mockReturnValue(false);
    const { client } = await fixture((request) => {
      if (request.url.includes("/status/")) return { body: { task_status: "success" } };
      if (request.url.includes("/result/")) return zipReply;
      return { body: { task_id: "zip-task" } };
    });
    const task = await client.convertFileAsyncToZip({ files: new Uint8Array([1]) });
    await task.waitForCompletion();
    expect(await client.getTaskResultFile(task.taskId)).toMatchObject({ success: true, data: zip });
  });
});
