import { type IncomingHttpHeaders, type Server, createServer } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Docling, createAPIClient } from "../../src";
import type { HttpRequestOptions } from "../../src/api/http";
import type { DoclingAPIClient } from "../../src/clients/api-client";
import { PlatformHttpClient } from "../../src/platform";

describe("HTTP retries through the public API factory", () => {
  let server: Server;
  let baseUrl: string;
  let attempts = 0;
  let failuresBeforeSuccess = Number.POSITIVE_INFINITY;
  const clients: DoclingAPIClient[] = [];
  const receivedHeaders: IncomingHttpHeaders[] = [];
  const downloadBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);

  beforeAll(async () => {
    server = createServer((request, response) => {
      request.resume();
      attempts++;
      receivedHeaders.push(request.headers);
      if (request.url === "/download" && attempts > failuresBeforeSuccess) {
        response.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="result.zip"',
          "Content-Length": downloadBytes.length,
        });
        response.end(downloadBytes);
        return;
      }
      response.writeHead(attempts <= failuresBeforeSuccess ? 503 : 200, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({ status: "ok" }));
    });
    server.requestTimeout = 1000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing loopback address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    attempts = 0;
    receivedHeaders.length = 0;
    failuresBeforeSuccess = Number.POSITIVE_INFINITY;
  });

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.destroy();
      client.chunks.getTaskManager().destroy();
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });

  function track(client: DoclingAPIClient): DoclingAPIClient {
    clients.push(client);
    // Keep loopback tests fast while exercising the real ofetch retry transport.
    client.getHttpClient().updateConfig({ retryDelay: 0 });
    return client;
  }

  it.each([
    { retries: 0, expected: 1 },
    { retries: 2, expected: 3 },
    { retries: undefined, expected: 4 },
  ])("makes $expected attempts with public retries=$retries", async ({ retries, expected }) => {
    const client = track(createAPIClient(baseUrl, { retries, timeout: 1000 }));
    expect(client.getHttpClient().getConfig().retries).toBe(retries ?? 3);
    await expect(client.health()).rejects.toThrow();
    expect(attempts).toBe(expected);
  });

  it("preserves zero through the Docling constructor factory", async () => {
    const client = track(new Docling({ api: { baseUrl, retries: 0 }, timeout: 1000 }));
    await expect(client.health()).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it.each([
    { headers: undefined, expectedHeaders: { "x-api-key": "configured-key" } },
    {
      headers: { "X-Custom-Header": "custom-value" },
      expectedHeaders: { "x-api-key": "configured-key", "x-custom-header": "custom-value" },
    },
    {
      headers: { "X-Api-Key": "custom-key", "X-Custom-Header": "custom-value" },
      expectedHeaders: { "x-api-key": "custom-key", "x-custom-header": "custom-value" },
    },
  ])(
    "preserves authentication and custom headers $headers when rebuilding for zero retries",
    async ({ headers, expectedHeaders }) => {
      const client = track(
        createAPIClient(baseUrl, { apiKey: "configured-key", headers, retries: 2, timeout: 1000 })
      );
      await expect(client.health()).rejects.toThrow();
      expect(attempts).toBe(3);
      expect(receivedHeaders).toEqual(Array(3).fill(expect.objectContaining(expectedHeaders)));
      const previousHttp = client.getHttpClient();
      client.updateConfig({ retries: 0 });
      expect(client.getHttpClient()).not.toBe(previousHttp);
      expect(client.getConfig().retries).toBe(0);
      expect(client.getHttpClient().getConfig().retries).toBe(0);
      attempts = 0;
      receivedHeaders.length = 0;
      await expect(client.health()).rejects.toThrow();
      expect(attempts).toBe(1);
      expect(receivedHeaders).toEqual([expect.objectContaining(expectedHeaders)]);

      client.updateConfig({ timeout: 1500 });
      attempts = 0;
      receivedHeaders.length = 0;
      await expect(client.health()).rejects.toThrow();
      expect(attempts).toBe(1);
      expect(receivedHeaders).toEqual([expect.objectContaining(expectedHeaders)]);
    }
  );

  it("applies updated custom headers over the configured API key", async () => {
    const client = track(
      createAPIClient(baseUrl, { apiKey: "configured-key", retries: 0, timeout: 1000 })
    );
    failuresBeforeSuccess = 0;
    await expect(client.health()).resolves.toMatchObject({ status: "ok" });
    expect(receivedHeaders[0]).toMatchObject({ "x-api-key": "configured-key" });

    client.updateConfig({ headers: { "X-Api-Key": "updated-key", "X-Custom-Header": "updated" } });
    await expect(client.health()).resolves.toMatchObject({ status: "ok" });
    expect(receivedHeaders[1]).toMatchObject({
      "x-api-key": "updated-key",
      "x-custom-header": "updated",
    });

    client.updateConfig({ headers: {} });
    await expect(client.health()).resolves.toMatchObject({ status: "ok" });
    expect(receivedHeaders[2]).toMatchObject({ "x-api-key": "configured-key" });
    expect(receivedHeaders[2]).not.toHaveProperty("x-custom-header");
    expect(attempts).toBe(3);
  });

  it.each(["", undefined])(
    "rotates and removes an API key using %s without another transport setting changing",
    async (apiKey) => {
      const client = track(createAPIClient(baseUrl, { apiKey: "old-key", retries: 0 }));
      failuresBeforeSuccess = 0;
      await client.health();
      client.updateConfig({ apiKey: "new-key" });
      await client.health();
      client.updateConfig({ apiKey });
      await client.health();
      expect(receivedHeaders.map((headers) => headers["x-api-key"])).toEqual([
        "old-key",
        "new-key",
        undefined,
      ]);
    }
  );

  it("preserves zero when updating the exposed HTTP transport directly", async () => {
    const client = track(createAPIClient(baseUrl, { retries: 2, timeout: 1000 }));
    client.getHttpClient().updateConfig({ retries: 0 });
    await expect(client.health()).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("honors zero and positive request overrides without changing public defaults", async () => {
    const client = track(createAPIClient(baseUrl, { retries: 2, timeout: 1000 }));
    await expect(client.getHttpClient().getJson("/health", { retries: 0 })).rejects.toThrow();
    expect(attempts).toBe(1);
    attempts = 0;
    await expect(client.getHttpClient().getJson("/health", { retries: 1 })).rejects.toThrow();
    expect(attempts).toBe(2);
    attempts = 0;
    await expect(client.health()).rejects.toThrow();
    expect(attempts).toBe(3);
    expect(client.getHttpClient().getConfig().retries).toBe(2);
  });

  it("allows a positive request override when the public default is zero", async () => {
    const client = track(createAPIClient(baseUrl, { retries: 0, timeout: 1000 }));
    await expect(client.getHttpClient().getJson("/health", { retries: 1 })).rejects.toThrow();
    expect(attempts).toBe(2);
    attempts = 0;
    await expect(client.health()).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  describe.each(["SDK", "platform"] as const)(
    "file stream retries through the %s adapter",
    (adapter) => {
      function createStreamRequest(retries: number, retryDelay = 0) {
        if (adapter === "SDK") {
          const http = track(createAPIClient(baseUrl, { retries, timeout: 1000 })).getHttpClient();
          http.updateConfig({ retryDelay });
          return (options: HttpRequestOptions = {}) => http.requestFileStream("/download", options);
        }

        const http = new PlatformHttpClient({ baseUrl, retry: retries, retryDelay, timeout: 1000 });
        return (options: HttpRequestOptions = {}) =>
          http.requestFileStream("/download", {
            retry: options.retries,
            retryDelay: options.retryDelay,
          });
      }

      async function readDownload(request: ReturnType<typeof createStreamRequest>) {
        const response = await request();
        expect(response.status).toBe(200);
        expect(response.fileMetadata).toMatchObject({
          filename: "result.zip",
          contentType: "application/zip",
          size: downloadBytes.length,
        });
        const stream = response.fileStream;
        if (!stream) throw new Error("Missing download stream");
        if ("getReader" in stream) {
          return Buffer.from(await new Response(stream).arrayBuffer());
        }
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
      }

      it.each([
        { defaultRetries: 2, retries: undefined, expected: 3 },
        { defaultRetries: 2, retries: 0, expected: 1 },
        { defaultRetries: 2, retries: 1, expected: 2 },
        { defaultRetries: 0, retries: 1, expected: 2 },
        { defaultRetries: 0, retries: undefined, expected: 1 },
      ])(
        "makes $expected attempts with default=$defaultRetries and override=$retries, preserving defaults",
        async ({ defaultRetries, retries, expected }) => {
          const request = createStreamRequest(defaultRetries);
          await expect(request({ retries })).rejects.toThrow();
          expect(attempts).toBe(expected);

          attempts = 0;
          await expect(request()).rejects.toThrow();
          expect(attempts).toBe(defaultRetries + 1);
        }
      );

      it("downloads the complete stream with a positive override on a zero default", async () => {
        const request = createStreamRequest(0);
        failuresBeforeSuccess = 1;
        const overridden = () => request({ retries: 1 });
        await expect(readDownload(overridden)).resolves.toEqual(downloadBytes);
        expect(attempts).toBe(2);

        attempts = 0;
        await expect(request()).rejects.toThrow();
        expect(attempts).toBe(1);
      });

      it.each([
        { defaultDelay: 0, retryDelay: 50 },
        { defaultDelay: 100, retryDelay: 0 },
      ])(
        "honors retryDelay=$retryDelay over default=$defaultDelay for a real stream download",
        async ({ defaultDelay, retryDelay }) => {
          const request = createStreamRequest(1, defaultDelay);
          failuresBeforeSuccess = 1;
          const timer = vi.spyOn(globalThis, "setTimeout");
          try {
            const overridden = () => request({ retryDelay });
            await expect(readDownload(overridden)).resolves.toEqual(downloadBytes);
            expect(attempts).toBe(2);
            if (retryDelay > 0) {
              expect(timer).toHaveBeenCalledWith(expect.any(Function), retryDelay);
            } else {
              expect(timer).not.toHaveBeenCalledWith(expect.any(Function), defaultDelay);
            }
          } finally {
            timer.mockRestore();
          }
        }
      );
    }
  );

  it("settles pending work when the public chunk service is destroyed directly", async () => {
    const client = track(createAPIClient(baseUrl, { retries: 0 }));
    const manager = client.chunks.getTaskManager();
    manager.startPollingExistingTask("pending");
    const waiting = manager.waitForCompletion("pending");
    client.chunks.destroy();
    expect(manager.getActiveTaskCount()).toBe(0);
    await expect(waiting).resolves.toMatchObject({
      success: false,
      error: { message: "Task manager destroyed" },
    });
    expect(attempts).toBe(0);
  });

  it.each(["destroy", "reconfigure"] as const)(
    "settles both public service managers when the client is asked to %s",
    async (action) => {
      const client = track(createAPIClient(baseUrl, { retries: 2, timeout: 1000 }));
      const managers = [client.getTaskManager(), client.chunks.getTaskManager()];
      for (const manager of managers) manager.startPollingExistingTask("pending");
      const waits = managers.map((manager) => manager.waitForCompletion("pending"));
      if (action === "destroy") client.destroy();
      else client.updateConfig({ retries: 0 });
      for (const waiting of waits) {
        await expect(waiting).resolves.toMatchObject({
          success: false,
          error: { message: "Task manager destroyed" },
          finalStatus: "failure",
        });
      }
      for (const manager of managers) expect(manager.getActiveTaskCount()).toBe(0);
      expect(attempts).toBe(0);
    }
  );

  it("returns a successful response within a positive retry budget", async () => {
    const client = track(createAPIClient(baseUrl, { retries: 2, timeout: 1000 }));
    failuresBeforeSuccess = 2;
    await expect(client.health()).resolves.toMatchObject({ status: "ok" });
    expect(attempts).toBe(3);
  });
});
