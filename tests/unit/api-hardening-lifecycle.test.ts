import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoclingAPIClient } from "../../src/clients/api-client";
import {
  loopback,
  readNodeStream,
  type Reply,
  type ReceivedRequest,
} from "./api-hardening-fixture";

const document = {
  document: { filename: "input.pdf", md_content: "# Content" },
  status: "success",
  processing_time: 1,
};
const zip = Buffer.from("PK fixture download");
const zipReply = { body: zip, headers: { "Content-Type": "application/zip" } };
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
async function fixture(respond: (request: ReceivedRequest) => Reply | Promise<Reply>) {
  const server = await loopback(respond);
  const client = new DoclingAPIClient({
    type: "api",
    baseUrl: server.baseUrl,
    retries: 0,
    waitSeconds: 0,
    timeout: 1000,
  });
  cleanups.push(server.close, () => client.destroy());
  return { ...server, client };
}
function sink() {
  const chunks: Buffer[] = [];
  const output = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, done) {
      setTimeout(() => {
        chunks.push(Buffer.from(chunk));
        done();
      }, 5);
    },
  });
  return {
    output,
    text: () => Buffer.concat(chunks).toString(),
    bytes: () => Buffer.concat(chunks),
  };
}

describe("API async and output lifecycles", () => {
  it.each(["convertSourceAsync", "convertFileAsync", "convertFileAsyncToZip"] as const)(
    "%s supports poll, repeated waits and result retrieval",
    async (method) => {
      const { client, requests } = await fixture((request) => {
        if (request.url.includes("/status/"))
          return { body: { task_id: "task-1", task_status: "success" } };
        if (request.url.includes("/result/")) return { body: document };
        return {
          body: {
            task_id: "task-1",
            task_status: "pending",
            task_position: 3,
            task_meta: { fixture: true },
          },
        };
      });
      const task =
        method === "convertSourceAsync"
          ? await client.convertSourceAsync({
              sources: [{ kind: "file", base64_string: "YQ==", filename: "input.pdf" }],
            })
          : await client[method]({ files: Buffer.from("input"), filename: "input.pdf" });
      expect(task).toMatchObject({
        taskId: "task-1",
        status: "pending",
        position: 3,
        meta: { fixture: true },
      });
      const progress = vi.fn();
      const complete = vi.fn();
      task.on("progress", progress).on("complete", complete);
      expect((await task.poll()).task_status).toBe("success");
      const [first, second] = await Promise.all([
        task.waitForCompletion(),
        task.waitForCompletion(),
      ]);
      expect(first.task_status).toBe("success");
      expect(second).toEqual(first);
      expect((await task.waitForCompletion()).task_status).toBe("success");
      expect(await task.getResult()).toEqual(document);
      expect(progress).toHaveBeenCalledWith(expect.objectContaining({ task_status: "success" }));
      expect(complete).toHaveBeenCalledWith(document);
      expect(client.getTaskManager().getActiveTaskCount()).toBe(0);
      expect(
        requests
          .filter((request) => request.url.includes("/status/"))
          .every((request) => request.url.endsWith("?wait=0"))
      ).toBe(true);
      if (method !== "convertSourceAsync")
        expect((await requests[0]!.form()).get("target_type")).toBe(
          method === "convertFileAsyncToZip" ? "zip" : "inbody"
        );
    }
  );

  it.each(["failure", "revoked"])(
    "rejects a %s API task without fetching results",
    async (status) => {
      const { client, requests } = await fixture((request) => ({
        body: request.url.includes("/status/")
          ? { task_id: "task-1", task_status: status }
          : { task_id: "task-1" },
      }));
      const task = await client.convertFileAsync({ files: Buffer.from("input") });
      await expect(task.waitForCompletion()).rejects.toThrow(`Task ${status}`);
      expect(requests.some((request) => request.url.includes("/result/"))).toBe(false);
    }
  );

  it("supports cancellation before waiting and reports the error through the task", async () => {
    const { client, requests } = await fixture(() => ({ body: { task_id: "cancelled" } }));
    const task = await client.convertFileAsync({ files: Buffer.from("input") });
    const onError = vi.fn();
    task.on("error", onError);
    await task.cancel?.();
    await expect(task.waitForCompletion()).rejects.toThrow("Task cancelled");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Task cancelled" }));
    expect(requests).toHaveLength(1);
  });

  it("rejects malformed task responses immediately", async () => {
    const { client } = await fixture(() => ({ body: {} }));
    await expect(client.convertFileAsync({ files: Buffer.from("input") })).rejects.toThrow(
      "missing task_id"
    );
    await expect(client.convertFileAsyncToZip({ files: Buffer.from("input") })).rejects.toThrow(
      "missing task_id"
    );
    await expect(
      client.convertSourceAsync({ sources: [{ kind: "http", url: "https://example.test/input" }] })
    ).rejects.toThrow("missing task_id");
  });

  it.each(["convertAsync", "convertStreamToFile"] as const)(
    "%s uses the real manager and downloads only after success",
    async (method) => {
      const { client, requests } = await fixture((request) => {
        if (request.url.includes("/status/"))
          return { body: { task_id: "task-1", task_status: "success" } };
        if (request.url.includes("/result/"))
          return method === "convertStreamToFile" ? zipReply : { body: document };
        return { body: { task_id: "task-1" } };
      });
      if (method === "convertAsync")
        expect(await client.convertAsync("input", "input.pdf")).toEqual(document);
      else {
        const result = await client.convertStreamToFile(Readable.from(["input"]), "input.pdf", {});
        expect(result.success).toBe(true);
        expect(await readNodeStream(result.fileStream)).toEqual(zip);
      }
      expect(requests.map((request) => request.url)).toEqual([
        "/v1/convert/file/async",
        "/v1/status/poll/task-1?wait=100",
        "/v1/result/task-1",
      ]);
    }
  );

  it.each(["md_content", "html_content", "text_content", "json"] as const)(
    "streams %s and waits for destination finish",
    async (format) => {
      const content =
        format === "json"
          ? { filename: "input.pdf", json_content: { pages: [] } }
          : { filename: "input.pdf", [format]: format === "md_content" ? "" : "content" };
      const { client, requests } = await fixture(() => ({ body: { document: content } }));
      const output = sink();
      expect(await client.convertToStream("input", "input.pdf", output.output)).toEqual({
        success: true,
      });
      expect(output.output.writableFinished).toBe(true);
      expect(output.text()).toBe(
        format === "json"
          ? JSON.stringify(content, null, 2)
          : format === "md_content"
            ? ""
            : "content"
      );
      expect(requests[0]?.json()).toMatchObject({
        target: { kind: "inbody" },
        sources: [
          {
            kind: "file",
            filename: "input.pdf",
            base64_string: Buffer.from("input").toString("base64"),
          },
        ],
      });
    }
  );

  it("streams a direct ZIP response with a POST body and finishes the destination", async () => {
    const { client, requests } = await fixture(() => zipReply);
    const output = sink();
    expect(
      await client.convertToStream(Buffer.from("input"), "input.pdf", output.output, {}, true)
    ).toEqual({ success: true });
    expect(requests[0]?.json()).toMatchObject({ target: { kind: "zip" } });
    expect(output.output.writableFinished).toBe(true);
    expect(output.bytes()).toEqual(zip);
    const download = await client.getTaskResultFile("task-1");
    expect(await readNodeStream(download.fileStream)).toEqual(zip);
  });

  it("falls back to async ZIP generation and reports missing final stream", async () => {
    let provideZip = true;
    const { client } = await fixture((request) => {
      if (request.url.endsWith("/async")) return { body: { task_id: "task-1" } };
      if (request.url.includes("/status/"))
        return { body: { task_id: "task-1", task_status: "success" } };
      if (request.url.includes("/result/") && provideZip) return zipReply;
      return { body: { queued: true } };
    });
    const output = sink();
    expect(await client.convertToStream("input", "input.pdf", output.output, {}, true)).toEqual({
      success: true,
    });
    expect(output.bytes()).toEqual(zip);
    provideZip = false;
    const emptyOutput = sink();
    expect(
      await client.convertToStream("input", "input.pdf", emptyOutput.output, {}, true)
    ).toMatchObject({ success: false, error: { message: "No stream or data received from API" } });
  });

  it.each([false, true])(
    "returns destination errors without uncaught events (ZIP=%s)",
    async (asZip) => {
      const { client } = await fixture(() => (asZip ? zipReply : { body: document }));
      const output = new Writable({
        write(_chunk, _encoding, done) {
          done(new Error("destination failed"));
        },
      });
      expect(await client.convertToStream("input", "input.pdf", output, {}, asZip)).toMatchObject({
        success: false,
        error: { details: "destination failed" },
      });
      expect(output.destroyed).toBe(true);
    }
  );

  it("supports minimal sinks and reports thrown writes", async () => {
    const { client } = await fixture(() => zipReply);
    const output = { write: vi.fn(() => true), end: vi.fn() };
    expect(await client.convertToStream("input", "input.pdf", output, {}, true)).toEqual({
      success: true,
    });
    expect(output.write).toHaveBeenCalledWith(zip);
    expect(output.end).toHaveBeenCalledOnce();
    output.write.mockImplementation(() => {
      throw new Error("write failed");
    });
    expect(await client.convertToStream("input", "input.pdf", output, {}, true)).toMatchObject({
      success: false,
      error: { details: "write failed" },
    });
  });

  it("tracks small conversion callbacks and cleans the upload interval on errors", async () => {
    const { client } = await fixture(() => ({ body: document }));
    const progress = vi.fn();
    expect(await client.convertWithProgress("input", "input.pdf", {}, progress)).toEqual(document);
    expect(progress.mock.calls.map(([update]) => update.stage)).toEqual([
      "preparing",
      "uploading",
      "completed",
    ]);
    client.updateConfig({ baseUrl: "http://127.0.0.1:1" });
    await expect(
      client.convertWithProgress("input", "input.pdf", {}, progress)
    ).rejects.toBeDefined();
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "error" }));
  });

  it("tracks large uploads with the requested filename and manager progress", async () => {
    const { client, requests } = await fixture((request) => {
      if (request.url.includes("/status/"))
        return { body: { task_id: "large", task_status: "success" } };
      if (request.url.includes("/result/")) return { body: document };
      return { body: { task_id: "large" } };
    });
    const progress = vi.fn();
    expect(
      await client.convertWithProgress(
        Buffer.alloc(10 * 1024 * 1024 + 1),
        "large.pdf",
        {},
        progress
      )
    ).toEqual(document);
    expect(((await requests[0]!.form()).get("files") as File).name).toBe("large.pdf");
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "completed", percentage: 100 })
    );
    expect(client.getTaskManager().listenerCount("status")).toBe(0);
  });

  it("isolates concurrent automatic progress trackers, preserves filenames and gets each result once", async () => {
    let nextId = 0;
    const { client, requests } = await fixture((request) => {
      if (request.url.includes("/status/")) return { body: { task_status: "success" } };
      if (request.url.includes("/result/"))
        return {
          body: {
            ...document,
            document: { ...document.document, filename: request.url.split("/").pop() },
          },
        };
      return { body: { task_id: `task-${++nextId}` } };
    });
    client.updateConfig({ progress: { method: "http", httpPollInterval: 5 } });
    const results = await Promise.all([
      client.convertWithAutoProgress("one", "one.pdf"),
      client.convertWithAutoProgress("two", "two.pdf"),
    ]);
    expect(results.map((result) => result.document.filename).sort()).toEqual(["task-1", "task-2"]);
    expect(requests.filter((request) => request.url.includes("/result/"))).toHaveLength(2);
    const uploads = requests.filter((request) => request.url === "/v1/convert/file/async");
    expect(
      await Promise.all(
        uploads.map(async (request) => ((await request.form()).get("files") as File).name)
      )
    ).toEqual(["one.pdf", "two.pdf"]);
  });

  it.each(["failure", "revoked", "error", "presigned"] as const)(
    "automatic progress settles and cleans up on %s",
    async (outcome) => {
      const { client, requests } = await fixture((request) => {
        if (request.url.includes("/status/"))
          return outcome === "error"
            ? { status: 422, body: { detail: "poll failed" } }
            : { body: { task_status: outcome === "presigned" ? "success" : outcome } };
        if (request.url.includes("/result/"))
          return { body: { url: "https://example.test/output" } };
        return { body: { task_id: "task-1" } };
      });
      await expect(
        client.convertWithAutoProgress(
          "input",
          "input.pdf",
          {},
          { method: "http", httpPollInterval: 5 }
        )
      ).rejects.toBeDefined();
      const count = requests.length;
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(requests).toHaveLength(count);
    }
  );

  it.each(["destroy", "reconfigure"] as const)(
    "%s settles automatic progress conversions",
    async (action) => {
      let observedStatus!: () => void;
      const statusRequested = new Promise<void>((resolve) => {
        observedStatus = resolve;
      });
      const { client, requests } = await fixture((request) => {
        if (request.url.includes("/status/")) {
          observedStatus();
          return { body: { task_status: "started" } };
        }
        return { body: { task_id: "task-1" } };
      });
      const waiting = client.convertWithAutoProgress(
        "input",
        "input.pdf",
        {},
        { method: "http", httpPollInterval: 5 }
      );
      const rejection = expect(waiting).rejects.toMatchObject({
        message: action === "destroy" ? "Client destroyed" : "Client reconfigured",
      });
      await statusRequested;
      if (action === "destroy") client.destroy();
      else client.updateConfig({ retries: 0 });
      await rejection;
      const count = requests.length;
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(requests).toHaveLength(count);
    }
  );

  it("uses synchronous fallback when progress is not configured", async () => {
    const { client, requests } = await fixture(() => ({ body: document }));
    expect(await client.convertWithAutoProgress("input", "input.pdf")).toEqual(document);
    expect(requests[0]?.url).toBe("/v1/convert/file");
  });
});

it("reports upload lifecycle without fabricated intermediate percentages", async () => {
  const { client } = await fixture(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { body: document };
  });
  const progress = vi.fn();
  expect(await client.convertWithProgress("input", "input.pdf", {}, progress)).toEqual(document);
  expect(progress.mock.calls.map(([update]) => [update.stage, update.percentage])).toEqual([
    ["preparing", undefined],
    ["uploading", 0],
    ["completed", 100],
  ]);
});

it("retains the task error message through large-file progress failure", async () => {
  const { client } = await fixture((request) => ({
    body: request.url.includes("/status/")
      ? { task_status: "failure" }
      : { task_id: "large-failure" },
  }));
  const progress = vi.fn();
  await expect(
    client.convertWithProgress(Buffer.alloc(10 * 1024 * 1024 + 1), "large.pdf", {}, progress)
  ).rejects.toMatchObject({ message: "Task failure", code: "Error" });
  expect(progress).toHaveBeenLastCalledWith({ stage: "error", message: "Task failure" });
  expect(client.getTaskManager().listenerCount("status")).toBe(0);
});
