import { File as NodeFile } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/api/http";
import { DoclingAPIClient } from "../../src/clients/api-client";
import { FileService } from "../../src/services/file";
import { ChunkService } from "../../src/services/chunk";
import { AsyncTaskManager } from "../../src/services/async-task-manager";
import { loopback, type ReceivedRequest, type Reply } from "./api-hardening-fixture";

const document = {
  document: { filename: "input.pdf", md_content: "# Content" },
  status: "success",
  processing_time: 1,
};
const chunked = {
  documents: [],
  chunks: [
    {
      filename: "input.pdf",
      chunk_index: 0,
      text: "content",
      num_tokens: 1,
      headings: [],
      captions: [],
      doc_items: [],
      page_numbers: [1],
    },
  ],
  processing_time: 1,
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
  respond: (request: ReceivedRequest) => Reply | Promise<Reply> = () => ({ body: chunked })
) {
  const server = await loopback(respond);
  const http = new HttpClient({ baseUrl: server.baseUrl, retries: 0, timeout: 1000 });
  const files = new FileService(http);
  const chunks = new ChunkService(http);
  const client = new DoclingAPIClient({ type: "api", baseUrl: server.baseUrl, retries: 0 });
  cleanups.push(server.close, () => {
    files.destroy();
    chunks.destroy();
    client.destroy();
  });
  return { ...server, http, files, chunks, client };
}
async function pathFixture() {
  const directory = await mkdtemp(join(tmpdir(), "service-hardening-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "input.pdf");
  await writeFile(path, "file bytes");
  return path;
}

describe("file/chunk services using actual multipart HTTP", () => {
  it.each(["chunkHybridSync", "chunkHierarchicalSync"] as const)(
    "%s serializes chunk and conversion fields",
    async (method) => {
      const { client, requests } = await fixture();
      expect(
        await client[method]("literal content", "input.PDF", {
          from_formats: ["pdf"],
          image_export_mode: "embedded",
          do_ocr: false,
          force_ocr: true,
          ocr_engine: "easyocr",
          ocr_lang: ["en", "fr"],
          pdf_backend: "dlparse_v4",
          table_mode: "accurate",
          table_cell_matching: false,
          pipeline: "standard",
          page_range: [1, 3],
          document_timeout: 0,
          abort_on_error: false,
          chunking_use_markdown_tables: true,
          chunking_include_raw_text: false,
          chunking_max_tokens: 256,
          chunking_tokenizer: "test/tokenizer",
          chunking_merge_peers: false,
        })
      ).toEqual(chunked);
      expect(requests[0]?.url).toBe(
        method === "chunkHybridSync" ? "/v1/chunk/hybrid/file" : "/v1/chunk/hierarchical/file"
      );
      const form = await requests[0]!.form();
      expect(form.getAll("convert_ocr_lang")).toEqual(["en", "fr"]);
      expect(form.getAll("convert_page_range")).toEqual(["1", "3"]);
      expect(form.get("convert_do_ocr")).toBe("false");
      expect(form.get("convert_document_timeout")).toBe("0");
      expect(form.get("chunking_max_tokens")).toBe("256");
      expect(form.get("chunking_merge_peers")).toBe("false");
      expect(form.get("chunking_tokenizer")).toBe("test/tokenizer");
      expect(form.get("target_type")).toBe("inbody");
      expect(await (form.get("files") as File).text()).toBe("literal content");
    }
  );

  it.each(["chunkHybridAsync", "chunkHierarchicalAsync"] as const)(
    "%s waits for a real successful task before retrieving chunks",
    async (method) => {
      const { client, requests } = await fixture((request) => {
        if (request.url.includes("/status/"))
          return { body: { task_id: "chunk-1", task_status: "success" } };
        if (request.url.includes("/result/")) return { body: chunked };
        return { body: { task_id: "chunk-1" } };
      });
      expect(await client[method](await pathFixture(), "input.pdf")).toEqual(chunked);
      expect(client.chunks.getTaskManager().getActiveTaskCount()).toBe(0);
      expect(requests.map((request) => request.url)).toEqual([
        method === "chunkHybridAsync"
          ? "/v1/chunk/hybrid/file/async"
          : "/v1/chunk/hierarchical/file/async",
        "/v1/status/poll/chunk-1?wait=100",
        "/v1/result/chunk-1",
      ]);
      expect(await ((await requests[0]!.form()).get("files") as File).text()).toBe("file bytes");
    }
  );

  it.each(["chunkHybridAsync", "chunkHierarchicalAsync"] as const)(
    "%s rejects failed and malformed tasks",
    async (method) => {
      let malformed = false;
      const { chunks, requests } = await fixture((request) => ({
        body: request.url.includes("/status/")
          ? { task_status: "failure" }
          : malformed
            ? {}
            : { task_id: "chunk-1" },
      }));
      await expect(chunks[method](Buffer.from("input"), "input.pdf")).rejects.toThrow(
        "Task failure"
      );
      expect(requests.some((request) => request.url.includes("/result/"))).toBe(false);
      malformed = true;
      await expect(chunks[method](Buffer.from("input"), "input.pdf")).rejects.toThrow("No task ID");
    }
  );

  it.each(["chunkHybridFileAsync", "chunkHierarchicalFileAsync"] as const)(
    "%s uploads browser File bytes and preserves filenames",
    async (method) => {
      const { client, requests } = await fixture(() => ({
        body: { task_id: "chunk-1", task_status: "pending" },
      }));
      await client[method]({
        files: [
          new NodeFile(["browser input"], "browser.pdf", { type: "application/pdf" }),
          new NodeFile(["fallback"], "fallback.bin"),
        ] as unknown as globalThis.File[],
        include_converted_doc: false,
        target_type: "zip",
      });
      const form = await requests[0]!.form();
      const uploaded = form.getAll("files") as File[];
      expect(uploaded.map((file) => file.name)).toEqual(["browser.pdf", "fallback.bin"]);
      expect(await Promise.all(uploaded.map((file) => file.text()))).toEqual([
        "browser input",
        "fallback",
      ]);
      expect(form.get("include_converted_doc")).toBe("false");
      expect(form.get("target_type")).toBe("zip");
    }
  );

  it.each(["chunkHybridFileAsync", "chunkHierarchicalFileAsync"] as const)(
    "%s supports repeated completion waits",
    async (method) => {
      const { client } = await fixture((request) => {
        if (request.url.includes("/status/"))
          return { body: { task_id: "chunk-1", task_status: "success" } };
        if (request.url.includes("/result/")) return { body: chunked };
        return { body: { task_id: "chunk-1", task_status: "pending" } };
      });
      const task = await client[method]({
        files: [Buffer.from("one"), Buffer.from("two")],
        filename: ["one.pdf", "two.txt"],
      });
      const progress = vi.fn();
      const complete = vi.fn();
      task.on("progress", progress).on("complete", complete);
      expect((await task.poll()).task_status).toBe("success");
      expect(
        (await Promise.all([task.waitForCompletion(), task.waitForCompletion()])).map(
          (result) => result.task_status
        )
      ).toEqual(["success", "success"]);
      expect(await task.getResult()).toEqual(chunked);
      expect(progress).toHaveBeenCalledWith(expect.objectContaining({ task_status: "success" }));
      expect(complete).toHaveBeenCalledWith(chunked);
    }
  );

  it.each(["failure", "revoked"])("manual chunk tasks terminate on %s", async (status) => {
    const { chunks } = await fixture((request) => ({
      body: request.url.includes("/status/")
        ? { task_id: "chunk-1", task_status: status }
        : { task_id: "chunk-1" },
    }));
    const task = await chunks.chunkHybridFileAsync({ files: Buffer.from("input") });
    expect((await task.waitForCompletion()).task_status).toBe(status);
  });

  it.each(["cancel", "destroy"] as const)(
    "%s settles waiting chunk task wrappers",
    async (action) => {
      const { chunks } = await fixture(() => ({ body: { task_id: "cancelled" } }));
      const task = await chunks.chunkHybridFileAsync({ files: Buffer.from("input") });
      const onError = vi.fn();
      task.on("error", onError);
      const waiting = task.waitForCompletion();
      const rejection = expect(waiting).rejects.toThrow(
        action === "cancel" ? "Task cancelled" : "Task manager destroyed"
      );
      if (action === "cancel") await task.cancel?.();
      else chunks.destroy();
      await rejection;
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(action === "cancel" ? "cancelled" : "destroyed"),
        })
      );
      expect(chunks.getTaskManager().getActiveTaskCount()).toBe(0);
    }
  );

  it.each([
    "chunkHybridSource",
    "chunkHierarchicalSource",
    "chunkHybridSourceAsync",
    "chunkHierarchicalSourceAsync",
  ] as const)("%s forwards source and chunk options", async (method) => {
    const { client, requests } = await fixture(() => ({
      body: method.endsWith("Async") ? { task_id: "source-1" } : chunked,
    }));
    const request = {
      sources: [{ kind: "http" as const, url: "https://example.test/input.pdf" }],
      convert_options: { do_ocr: false },
      chunking_options: { use_markdown_tables: true },
      include_converted_doc: true,
      target: { kind: "inbody" as const },
    };
    const result = await client[method](request);
    expect(requests[0]?.json()).toEqual(request);
    const kind = method.includes("Hybrid") ? "hybrid" : "hierarchical";
    expect(requests[0]?.url).toBe(
      `/v1/chunk/${kind}/source${method.endsWith("Async") ? "/async" : ""}`
    );
    if (method.endsWith("Async")) expect(result).toMatchObject({ taskId: "source-1" });
    else expect(result).toEqual(chunked);
  });

  it("rejects malformed chunk wrapper task responses", async () => {
    const { chunks } = await fixture(() => ({ body: {} }));
    await expect(
      chunks.chunkHierarchicalFileAsync({ files: Buffer.from("input") })
    ).rejects.toThrow("missing task_id");
  });

  it("file service reads Node paths and serializes nested and false options", async () => {
    const { files, requests } = await fixture(() => ({ body: document }));
    expect(
      await files.convert(await pathFixture(), "input.pdf", {
        to_formats: ["html", "json"],
        do_ocr: false,
        force_ocr: true,
        table_cell_matching: false,
        do_table_structure: false,
        include_images: false,
        images_scale: 0,
        generate_page_images: false,
        generate_picture_images: false,
        do_code_enrichment: true,
        do_formula_enrichment: false,
        do_picture_classification: false,
        do_picture_description: true,
        picture_description_area_threshold: 0,
        abort_on_error: false,
        document_timeout: 0,
        md_page_break_placeholder: "",
        create_legacy_output: false,
        force_backend_text: false,
        ocr_options: { kind: "easyocr", lang: ["en"] },
        accelerator_options: { device: "cpu", num_threads: 2 },
      })
    ).toEqual(document);
    const form = await requests[0]!.form();
    expect(form.getAll("to_formats")).toEqual(["html", "json"]);
    expect(form.get("images_scale")).toBe("0");
    expect(form.get("md_page_break_placeholder")).toBe("");
    expect(form.get("do_ocr")).toBe("false");
    expect(JSON.parse(String(form.get("ocr_options")))).toEqual({ kind: "easyocr", lang: ["en"] });
    expect(await (form.get("files") as File).text()).toBe("file bytes");
  });

  it.each(["convertAsync", "convertToFileAsync", "convertStreamToFile"] as const)(
    "%s handles missing task IDs without polling",
    async (method) => {
      const { files, requests } = await fixture(() => ({ body: {} }));
      if (method === "convertAsync")
        await expect(files.convertAsync("content", "input.pdf")).rejects.toThrow("task_id");
      else {
        const result =
          method === "convertToFileAsync"
            ? await files.convertToFileAsync("content", "input.pdf", {})
            : await files.convertStreamToFile(Readable.from(["content"]), "input.pdf", {});
        expect(result).toMatchObject({
          success: false,
          error: { message: expect.stringContaining("task_id") },
        });
      }
      expect(requests).toHaveLength(1);
    }
  );

  it("file stream conversions reject responses without document content", async () => {
    const { files } = await fixture(() => ({ body: { unrelated: true } }));
    await expect(files.convertStream(Readable.from(["content"]), "input.pdf")).rejects.toThrow(
      "No data received"
    );
  });

  it("submits and retrieves manager tasks over HTTP, preserving zero waitSeconds", async () => {
    let polls = 0;
    const { http, requests } = await fixture((request) => {
      if (request.url.includes("/status/"))
        return { body: { task_status: ++polls === 1 ? "started" : "success" } };
      if (request.url.includes("/result/")) return { body: document };
      return { body: { task_id: "managed" } };
    });
    const manager = new AsyncTaskManager(http);
    cleanups.push(() => manager.destroy());
    const taskId = await manager.submitTask(
      "/submit",
      { fixture: true },
      { waitSeconds: 0, pollInterval: 10 }
    );
    expect((await manager.waitForCompletion(taskId)).success).toBe(true);
    expect(await manager.getTaskResult(taskId)).toEqual(document);
    expect(
      requests.filter((request) => request.url.includes("/status/")).map((request) => request.url)
    ).toEqual(["/v1/status/poll/managed?wait=0", "/v1/status/poll/managed?wait=0"]);
    expect(requests[0]?.json()).toEqual({ fixture: true });
  });
});
