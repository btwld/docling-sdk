// API follow-up regressions for review-api-findings.md (2026-11-06).
import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/api/http";
import { DoclingAPIClient } from "../../src/clients/api-client";
import { PlatformHttpClient } from "../../src/platform/http";
import { DoclingNetworkError } from "../../src/types";
import type { components } from "../../src/types/generated/api";
import { type ReceivedRequest, type Reply, loopback } from "./api-hardening-fixture";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
async function fixture(respond: (request: ReceivedRequest) => Reply) {
  const server = await loopback(respond);
  const client = new DoclingAPIClient({
    type: "api",
    baseUrl: server.baseUrl,
    retries: 0,
    timeout: 1000,
  });
  cleanups.push(server.close, () => client.destroy());
  return { ...server, client };
}
async function within<T>(promise: Promise<T>, milliseconds = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Operation did not settle")), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("API observer failure settlement", () => {
  it.each(["throw", "reject"] as const)(
    "settles original result/poll errors even when onError observers %s",
    async (mode) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      let failure: "poll" | "result" = "result";
      const { client, requests } = await fixture((request) => {
        if (request.url.includes(`/${failure === "poll" ? "status" : "result"}/`))
          return { status: 422, body: { detail: `${failure} failed` } };
        if (request.url.includes("/status/")) return { body: { task_status: "success" } };
        return { body: { task_id: "observer-task" } };
      });
      for (failure of ["result", "poll"] as const) {
        const onError = vi.fn(() => {
          if (mode === "throw") throw new Error("observer failed");
          return Promise.reject(new Error("observer failed"));
        });
        await expect(
          within(
            client.convertWithAutoProgress(
              new Uint8Array([1]),
              "input.pdf",
              {},
              {
                method: "http",
                httpPollInterval: 5,
                onError,
              }
            )
          )
        ).rejects.toMatchObject({
          message: `${failure} failed`,
          code: "NETWORK_ERROR",
          details: { detail: `${failure} failed` },
        });
        expect(onError).toHaveBeenCalledOnce();
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({ message: `${failure} failed`, statusCode: 422 })
        );
      }
      expect(requests.filter((request) => request.url.includes("/result/"))).toHaveLength(1);
      const count = requests.length;
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(requests).toHaveLength(count);
    }
  );

  it.each(["throw", "reject"] as const)(
    "retains task errors and notifies remaining task error listeners when one observer %s",
    async (mode) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { client } = await fixture((request) => ({
        body: request.url.includes("/status/")
          ? { task_status: "failure" }
          : { task_id: "failed-task" },
      }));
      const task = await client.convertFileAsync({ files: new Uint8Array([1]) });
      const nextObserver = vi.fn();
      task.on("error", () => {
        if (mode === "throw") throw new Error("observer failed");
        return Promise.reject(new Error("observer failed"));
      });
      task.on("error", nextObserver);
      await expect(within(task.waitForCompletion(), 2000)).rejects.toThrow("Task failure");
      expect(nextObserver).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Task failure" })
      );
      expect(client.getTaskManager().getActiveTaskCount()).toBe(0);
    }
  );

  it.each(["throw", "reject"] as const)(
    "retains convertWithProgress errors when the error-stage observer %s",
    async (mode) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { client } = await fixture(() => ({ status: 422, body: { detail: "upload failed" } }));
      await expect(
        client.convertWithProgress(new Uint8Array([1]), "input.pdf", {}, (update) => {
          if (update.stage !== "error") return;
          if (mode === "throw") throw new Error("observer failed");
          return Promise.reject(new Error("observer failed"));
        })
      ).rejects.toMatchObject({ message: "upload failed", code: "NETWORK_ERROR" });
    }
  );

  it("preserves a real-schema partial conversion result after successful task monitoring", async () => {
    const partial = {
      document: { filename: "input.pdf", md_content: "# Partial" },
      status: "partial_success",
      errors: [{ component_type: "model", module_name: "ocr", error_message: "Page 2 failed" }],
      processing_time: 1,
      timings: {},
    } satisfies components["schemas"]["ConvertDocumentResponse"];
    const { client, requests } = await fixture((request) => ({
      body: request.url.includes("/status/")
        ? { task_id: "partial-task", task_status: "success" }
        : request.url.includes("/result/")
          ? partial
          : { task_id: "partial-task", task_status: "pending" },
    }));
    const onError = vi.fn();
    expect(
      await client.convertWithAutoProgress(
        new Uint8Array([1]),
        "input.pdf",
        {},
        {
          method: "http",
          httpPollInterval: 5,
          onError,
        }
      )
    ).toEqual(partial);
    expect(onError).not.toHaveBeenCalled();
    expect(requests.filter((request) => request.url.includes("/result/"))).toHaveLength(1);
  });
});

describe("bounded streamed HTTP error diagnostics", () => {
  it("settles a real stalled error body using the per-request timeout and preserves status", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(422, { "Content-Type": "application/json" });
      response.write('{"detail":');
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    const http = new HttpClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      retries: 0,
      timeout: 5000,
    });
    await expect(within(http.requestFileStream("/stalled", { timeout: 40 }))).rejects.toMatchObject(
      {
        statusCode: 422,
        message: expect.stringContaining("422"),
      }
    );
  });

  it.each(["SDK", "platform"] as const)(
    "%s preserves HTTP status and cancels byte excess without waiting for cancellation",
    async (adapter) => {
      let bytesRead = 0;
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      // 40 Ki characters fit under 64 Ki characters, but exceed 64 KiB in UTF-8.
      const payload = new TextEncoder().encode("é".repeat(40 * 1024));
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = payload.subarray(bytesRead, bytesRead + 4096);
          bytesRead += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel,
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 422 }));
      const http =
        adapter === "SDK"
          ? new HttpClient({ baseUrl: "https://error.test", retries: 0 })
          : new PlatformHttpClient({ baseUrl: "https://error.test", retry: 0 });
      await expect(within<unknown>(http.requestFileStream("/oversized"))).rejects.toMatchObject({
        statusCode: 422,
        message: expect.stringContaining("422"),
      });
      expect(cancel).toHaveBeenCalledOnce();
      expect(bytesRead).toBeLessThan(payload.byteLength);
      expect(stream.locked).toBe(false);
    }
  );

  it.each(["SDK", "platform", "file consumer"] as const)(
    "%s preserves HTTP failure when reading the body rejects",
    async (adapter) => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error("body read failed"));
        },
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 422 }));
      if (adapter === "file consumer") {
        const client = new DoclingAPIClient({
          type: "api",
          baseUrl: "https://error.test",
          retries: 0,
        });
        cleanups.push(() => client.destroy());
        expect(await within(client.getTaskResultFile("failed"))).toMatchObject({
          success: false,
          error: { details: { statusCode: 422 }, message: expect.stringContaining("422") },
        });
      } else {
        const http =
          adapter === "SDK"
            ? new HttpClient({ baseUrl: "https://error.test", retries: 0 })
            : new PlatformHttpClient({ baseUrl: "https://error.test", retry: 0 });
        await expect(within<unknown>(http.requestFileStream("/broken"))).rejects.toMatchObject({
          statusCode: 422,
          message: expect.stringContaining("422"),
        });
      }
      expect(stream.locked).toBe(false);
    }
  );

  it("retains small structured diagnostics and cancels each failed retry body", async () => {
    const cancelled: ReturnType<typeof vi.fn>[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (cancelled.length === 2)
        return new Response('{"detail":"final failure"}', { status: 503 });
      const cancel = vi.fn();
      cancelled.push(cancel);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024 + 1));
          },
          cancel,
        }),
        { status: 503 }
      );
    });
    const http = new HttpClient({ baseUrl: "https://error.test", retries: 2, retryDelay: 0 });
    await expect(within(http.requestFileStream("/retried"))).rejects.toMatchObject({
      statusCode: 503,
      message: "final failure",
      response: { detail: "final failure" },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const cancel of cancelled) expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses a finite diagnostic deadline when the normal request timeout is disabled", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream, { status: 422 }));
    const http = new HttpClient({ baseUrl: "https://error.test", retries: 0, timeout: 0 });
    await expect(within(http.requestFileStream("/stalled"), 1500)).rejects.toBeInstanceOf(
      DoclingNetworkError
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});
