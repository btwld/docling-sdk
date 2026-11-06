import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/api/http";
import { PlatformHttpClient, createHttpClient } from "../../src/platform/http";
import { DoclingNetworkError, DoclingTimeoutError } from "../../src/types";
import { loopback, readNodeStream, type Reply } from "./api-hardening-fixture";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
async function fixture(reply: Reply = { body: { ok: true } }) {
  const server = await loopback(() => reply);
  cleanup.push(server.close);
  const config = { baseUrl: `${server.baseUrl}/`, retries: 0, retry: 0, retryDelay: 0 };
  return { ...server, http: new HttpClient(config), platform: createHttpClient(config) };
}

describe("public HTTP serialization and downloads", () => {
  it.each([
    { "x-api-key": "override", "content-type": "text/custom" },
    new Headers({ "X-API-KEY": "override", "content-type": "text/custom" }),
    [
      ["x-api-key", "override"],
      ["content-type", "text/custom"],
    ],
  ] as HeadersInit[])("overrides headers case-insensitively for %j", async (headers) => {
    const { http, requests } = await fixture();
    http.updateConfig({ headers: { "X-Api-Key": "default" } });
    await http.post("/echo", "payload", { headers });
    expect(requests[0]?.headers).toMatchObject({
      "x-api-key": "override",
      "content-type": "text/custom",
    });
    expect(requests[0]?.body.toString()).toBe("payload");
  });

  it.each(["uploadFiles", "streamUpload"] as const)(
    "%s preserves request headers and generates the actual multipart boundary",
    async (method) => {
      const { http, requests } = await fixture();
      http.updateConfig({ headers: { "content-type": "application/json", "X-Api-Key": "base" } });
      await http[method](
        "/upload",
        [
          {
            name: "files",
            data: Buffer.from("pdf bytes"),
            filename: "résumé.pdf",
            contentType: "application/pdf",
          },
        ],
        { formats: ["md", "json"], enabled: false, count: 0, omitted: null },
        { headers: new Headers({ "x-api-key": "request", "Content-Type": "wrong/type" }) }
      );
      expect(requests[0]?.headers["x-api-key"]).toBe("request");
      expect(requests[0]?.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
      const form = await requests[0]!.form();
      expect(form.getAll("formats")).toEqual(["md", "json"]);
      expect(form.get("enabled")).toBe("false");
      expect(form.get("count")).toBe("0");
      expect(form.has("omitted")).toBe(false);
      const file = form.get("files") as File;
      expect(file.name).toBe("résumé.pdf");
      expect(file.type).toBe("application/pdf");
      expect(await file.text()).toBe("pdf bytes");
    }
  );

  it("supports text responses without parsing them as JSON", async () => {
    const { http, platform } = await fixture({ body: "plain response" });
    expect((await http.requestText("/text")).data).toBe("plain response");
    expect((await platform.getText("/text")).data).toBe("plain response");
    expect(
      (await http.uploadFiles("/text", [{ name: "files", data: "text" }], {}, { accept: "text" }))
        .data
    ).toBe("plain response");
  });

  it("returns bytes from ordinary and passthrough ZIP uploads", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0, 255]);
    const { http, platform } = await fixture({
      body: bytes,
      headers: { "Content-Type": "application/zip" },
    });
    expect((await http.requestBytes("/bytes")).data).toEqual(bytes);
    expect((await platform.getBytes("/bytes")).data).toEqual(new Uint8Array(bytes));
    expect((await http.uploadFiles("/bytes", [], {}, { accept: "bytes" })).data).toEqual(bytes);
    expect(
      (
        await http.streamPassthrough(
          "/bytes",
          Readable.from(["input"]),
          "input.pdf",
          "application/pdf",
          {},
          { accept: "zip" }
        )
      ).data
    ).toEqual(bytes);
  });

  it.each(["SDK", "platform"] as const)(
    "sends POST body when requesting a file stream through %s",
    async (adapter) => {
      const bytes = Buffer.from("PK response");
      const { http, platform, requests } = await fixture({
        body: bytes,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="result.zip"',
          "Content-Length": String(bytes.length),
        },
      });
      const options = {
        method: "POST" as const,
        body: JSON.stringify({ sources: ["input"] }),
        headers: { "Content-Type": "application/json" },
      };
      if (adapter === "SDK") {
        const response = await http.requestFileStream("/convert", options);
        expect(await readNodeStream(response.fileStream)).toEqual(bytes);
        expect(response.fileMetadata).toEqual({
          filename: "result.zip",
          contentType: "application/zip",
          size: bytes.length,
        });
      } else {
        const response = await platform.requestFileStream("/convert", options);
        expect(Buffer.from(await new Response(response.fileStream).arrayBuffer())).toEqual(bytes);
      }
      expect(requests[0]?.json()).toEqual({ sources: ["input"] });
    }
  );

  it.each([
    { body: { state: "pending" }, expected: { state: "pending" } },
    { body: "pending", expected: "pending" },
  ])("returns a non-file stream response as data: $expected", async ({ body, expected }) => {
    const { http } = await fixture({ body });
    const response = await http.requestFileStream("/result");
    expect(response.data).toEqual(expected);
    expect(response.fileStream).toBeUndefined();
  });

  it("preserves JSON helper verbs, request bodies and empty bodies", async () => {
    const { http, platform, requests } = await fixture();
    await http.getJson("/get");
    await http.postJson("/post", { enabled: false });
    await http.putJson("/put", { number: 0 });
    await http.deleteJson("/delete");
    await http.put("/raw", new Uint8Array([1, 2]));
    await http.delete("/raw");
    await platform.postJson("/post", { nested: [1] });
    await platform.putJson("/put", { empty: null });
    await platform.deleteJson("/delete");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "PUT",
      "DELETE",
      "POST",
      "PUT",
      "DELETE",
    ]);
    expect(requests[1]?.json()).toEqual({ enabled: false });
    expect(requests[2]?.json()).toEqual({ number: 0 });
    expect(requests[4]?.body).toEqual(Buffer.from([1, 2]));
    expect(requests[6]?.json()).toEqual({ nested: [1] });
    expect(requests[7]?.json()).toEqual({ empty: null });
  });

  it.each([
    { detail: "bad input" },
    { detail: [{ msg: "bad input" }, { message: "second reason" }] },
    { message: "bad input" },
    { error: "bad input" },
  ])("normalizes structured errors from the transport", async (body) => {
    const { http } = await fixture({ body, status: 422 });
    await expect(http.getJson("/invalid")).rejects.toBeInstanceOf(DoclingNetworkError);
    await expect(http.getJson("/invalid")).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining("bad input"),
      response: body,
    });
  });

  it("applies query, hooks, custom retry codes and ignored response errors", async () => {
    let attempts = 0;
    const server = await loopback(() => ({
      status: ++attempts === 1 ? 409 : 200,
      body: { ok: true },
    }));
    cleanup.push(server.close);
    const platform = new PlatformHttpClient({ baseUrl: server.baseUrl, retry: 1, retryDelay: 0 });
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    expect(
      (
        await platform.get("/query", {
          query: { flag: false, n: 0 },
          retryStatusCodes: [409],
          onRequest,
          onResponse,
        })
      ).data
    ).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(server.requests[0]?.url).toBe("/query?flag=false&n=0");
    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(onResponse).toHaveBeenCalledTimes(2);
    attempts = 0;
    expect((await platform.get("/ignored", { ignoreResponseError: true })).status).toBe(409);
    expect(attempts).toBe(1);
  });

  it("reports real timeout errors using the SDK error type", async () => {
    const server = await loopback(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { body: { ok: true } };
    });
    cleanup.push(server.close);
    const http = new HttpClient({ baseUrl: server.baseUrl, retries: 0, timeout: 10 });
    await expect(http.get("/slow")).rejects.toBeInstanceOf(DoclingTimeoutError);
  });
});

describe("public upload adapters and retained transport imports", () => {
  it.each([0, 5])("chunked upload reports finite progress for a %s-byte stream", async (size) => {
    const { http, requests } = await fixture();
    const progress = vi.fn();
    const bytes = new Uint8Array(size).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    expect(
      (
        await http.chunkedStreamUpload(
          "/chunked",
          { name: "files", filename: "file.bin", stream, size },
          {},
          { chunkSize: 2, onProgress: progress }
        )
      ).status
    ).toBe(200);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "completed",
        chunkIndex: size === 0 ? 0 : 3,
        totalChunks: size === 0 ? 0 : 3,
      })
    );
    expect(progress.mock.calls.every(([update]) => Number.isFinite(update.chunkIndex))).toBe(true);
    expect(
      (await ((await requests[0]!.form()).get("files") as File).arrayBuffer()).byteLength
    ).toBe(size);
  });

  it("retains callable pool compatibility adapters with documented no-op results", async () => {
    const { http, platform, baseUrl } = await fixture();
    expect(http.getPoolStats()).toEqual({ total: 0, pending: 0, free: 0, active: 0 });
    expect(http.getPoolHealth()).toEqual({ healthy: true });
    http.updatePoolConfig({ maxSockets: 1 });
    http.closeIdleConnections();
    http.destroy();
    // Retained public compatibility methods must not disable subsequent transport requests.
    expect((await http.getJson("/health")).data).toEqual({ ok: true });
    expect((await platform.getJson("/health")).data).toEqual({ ok: true });
    expect(platform.getConfig().baseUrl).toBe(baseUrl);
    expect(http.getConfig().baseUrl).toBe(baseUrl);
  });

  it("releases a failed input stream and does not make an HTTP request", async () => {
    const { http, requests } = await fixture();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("input failed"));
      },
    });
    await expect(http.streamUpload("/upload", [{ name: "files", data: stream }])).rejects.toThrow(
      "input failed"
    );
    expect(stream.locked).toBe(false);
    expect(requests).toHaveLength(0);
    const nodeStream = new Readable({
      read() {
        this.destroy(new Error("node input failed"));
      },
    });
    await expect(
      http.pipelineUpload("/upload", { name: "files", filename: "input.pdf", stream: nodeStream })
    ).rejects.toThrow("node input failed");
    expect(requests).toHaveLength(0);
  });
});

it.each([
  {
    body: new Blob(["blob data"], { type: "text/plain" }),
    expected: "blob data",
    type: "text/plain",
  },
  {
    body: new URLSearchParams({ query: "a b" }),
    expected: "query=a+b",
    type: "application/x-www-form-urlencoded;charset=UTF-8",
  },
  { body: new Uint16Array([1, 2]), expected: Buffer.from([1, 0, 2, 0]), type: "application/json" },
  { body: new Uint8Array([1, 2]).buffer, expected: Buffer.from([1, 2]), type: "application/json" },
  { body: null, expected: "", type: "application/json" },
])("preserves standard BodyInit payloads ($body)", async ({ body, expected, type }) => {
  const { http, requests } = await fixture();
  await http.post("/body", body);
  expect(requests[0]?.headers["content-type"]).toBe(type);
  if (typeof expected === "string") expect(requests[0]?.body.toString()).toBe(expected);
  else expect(requests[0]?.body).toEqual(expected);
});
