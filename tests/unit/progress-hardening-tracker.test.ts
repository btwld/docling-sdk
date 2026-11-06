import { createServer, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/api/http";
import { ProgressTracker } from "../../src/services/progress-tracker";
import type { ProgressConfig } from "../../src/types/client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const trackers: ProgressTracker[] = [];
const servers: Server[] = [];
const webSockets: WebSocketServer[] = [];
async function wait(ms = 25) {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
async function fixture(
  config: ProgressConfig = {},
  status?: (url: string, response: ServerResponse) => void,
  websocket = false
) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    response.setHeader("content-type", "application/json");
    if (status) status(request.url!, response);
    else
      response.end(
        JSON.stringify(
          request.url!.startsWith("/v1/status/")
            ? { task_status: "success", task_position: 3 }
            : { markdown: "result" }
        )
      );
  });
  servers.push(server);
  let ws: WebSocketServer | undefined;
  if (websocket) {
    ws = new WebSocketServer({ server });
    webSockets.push(ws);
  }
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tracker = new ProgressTracker(
    new HttpClient({ baseUrl, retries: 0, timeout: 1000 }),
    baseUrl,
    { method: "http", httpPollInterval: 5, websocketTimeout: 1000, ...config }
  );
  trackers.push(tracker);
  return { tracker, requests, ws, server };
}
afterEach(async () => {
  for (const tracker of trackers.splice(0)) tracker.destroy();
  for (const server of webSockets.splice(0)) {
    for (const peer of server.clients) peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
});

describe("ProgressTracker HTTP public lifecycle", () => {
  it("reports serial progress, completion and exact result data", async () => {
    let checks = 0;
    const complete = deferred<unknown>();
    const progress = vi.fn();
    const event = vi.fn();
    const { tracker, requests } = await fixture(
      { onProgress: progress, onComplete: (value) => complete.resolve(value) },
      (url, response) => {
        response.end(
          JSON.stringify(
            url.startsWith("/v1/status/")
              ? { task_status: ++checks === 1 ? "started" : "success", task_position: 3 }
              : false
          )
        );
      }
    );
    tracker.on("complete", event);
    await tracker.startTracking("task/1");
    expect(await complete.promise).toBe(false);
    await wait();
    expect(requests).toEqual(["/v1/status/task%2F1", "/v1/status/task%2F1", "/v1/result/task%2F1"]);
    expect(
      progress.mock.calls.map(([value]) => [value.stage, value.percentage, value.source])
    ).toEqual([
      ["started", undefined, "http"],
      ["completed", 100, "http"],
    ]);
    expect(event).toHaveBeenCalledWith(false);
  });

  it("does not overlap slow requests or restart after a stop during a pending status response", async () => {
    const received = deferred<ServerResponse>();
    const progress = vi.fn();
    const complete = vi.fn();
    const { tracker, requests } = await fixture(
      { onProgress: progress, onComplete: complete },
      (_url, response) => received.resolve(response)
    );
    await tracker.startTracking("task");
    const response = await received.promise;
    await wait(25);
    expect(requests).toHaveLength(1);
    await tracker.stopTracking();
    response.end(JSON.stringify({ task_status: "success" }));
    await wait(25);
    expect(requests).toHaveLength(1);
    expect(progress).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("ignores a stale response after replacement with the same task ID", async () => {
    const old = deferred<ServerResponse>();
    let count = 0;
    const completed = deferred<unknown>();
    const { tracker, requests } = await fixture(
      { onComplete: (value) => completed.resolve(value) },
      (url, response) => {
        if (++count === 1) old.resolve(response);
        else
          response.end(
            JSON.stringify(
              url.startsWith("/v1/status/") ? { task_status: "success" } : { latest: true }
            )
          );
      }
    );
    await tracker.startTracking("same");
    const stale = await old.promise;
    await tracker.startTracking("same");
    expect(await completed.promise).toEqual({ latest: true });
    stale.end(JSON.stringify({ task_status: "failure" }));
    await wait();
    expect(requests).toEqual(["/v1/status/same", "/v1/status/same", "/v1/result/same"]);
  });

  it("ignores a pending result after destruction and rejects attempts to restart", async () => {
    const result = deferred<ServerResponse>();
    const complete = vi.fn();
    const error = vi.fn();
    const { tracker, requests } = await fixture(
      { onComplete: complete, onError: error },
      (url, response) => {
        if (url.startsWith("/v1/result/")) result.resolve(response);
        else response.end(JSON.stringify({ task_status: "success" }));
      }
    );
    await tracker.startTracking("task");
    const response = await result.promise;
    tracker.destroy();
    tracker.destroy();
    response.end(JSON.stringify({ stale: true }));
    await wait();
    expect(complete).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(requests).toHaveLength(2);
    await expect(tracker.startTracking("new")).rejects.toThrow("destroyed");
  });

  it.each(["failure", "status-http-error", "result-http-error"])(
    "reports terminal %s exactly once and stops",
    async (failure) => {
      const onError = vi.fn();
      const complete = vi.fn();
      const event = deferred<Error>();
      const { tracker, requests } = await fixture(
        { onError, onComplete: complete },
        (url, response) => {
          if (
            (failure === "status-http-error" && url.startsWith("/v1/status/")) ||
            (failure === "result-http-error" && url.startsWith("/v1/result/"))
          ) {
            response.statusCode = 503;
            response.end("{}");
          } else
            response.end(
              JSON.stringify({ task_status: failure === "failure" ? "failure" : "success" })
            );
        }
      );
      tracker.on("error", (error) => event.resolve(error));
      await tracker.startTracking("task");
      expect(await event.promise).toBeInstanceOf(Error);
      await wait();
      expect(onError).toHaveBeenCalledOnce();
      expect(complete).not.toHaveBeenCalled();
      expect(requests).toHaveLength(failure === "result-http-error" ? 2 : 1);
    }
  );

  it("does not stop a new task started by an asynchronous completion callback", async () => {
    let tracker!: ProgressTracker;
    let completions = 0;
    const complete = deferred<void>();
    const result = await fixture({
      onComplete: async () => {
        if (++completions === 1) await tracker.startTracking("next");
        else complete.resolve();
      },
    });
    tracker = result.tracker;
    await tracker.startTracking("first");
    await complete.promise;
    await wait();
    expect(result.requests).toEqual([
      "/v1/status/first",
      "/v1/result/first",
      "/v1/status/next",
      "/v1/result/next",
    ]);
  });

  it("contains throwing callbacks and stops safely after completion/error observers fail", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = deferred<Error>();
    const { tracker, requests } = await fixture({
      onProgress: () => {
        throw new Error("observer progress");
      },
      onComplete: () => {
        throw new Error("observer complete");
      },
      onError: (value) => {
        error.resolve(value);
        throw new Error("observer error");
      },
    });
    await tracker.startTracking("task");
    expect((await error.promise).message).toBe("observer complete");
    await wait();
    expect(logged).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(2);
  });
});

describe("ProgressTracker WebSocket and hybrid fallback", () => {
  it("uses real WebSocket updates without polling and fetches one terminal result", async () => {
    const progress = vi.fn();
    const complete = deferred<unknown>();
    const { tracker, ws, requests } = await fixture(
      { method: "websocket", onProgress: progress, onComplete: (value) => complete.resolve(value) },
      undefined,
      true
    );
    ws!.on("connection", (peer) => {
      peer.send(
        JSON.stringify({ message: "update", task: { task_id: "other", task_status: "success" } })
      );
      peer.send(
        JSON.stringify({ message: "update", task: { task_id: "task", task_status: "started" } })
      );
      peer.send(
        JSON.stringify({ message: "update", task: { task_id: "task", task_status: "success" } })
      );
    });
    await tracker.startTracking("task");
    expect(await complete.promise).toEqual({ markdown: "result" });
    await wait();
    expect(requests).toEqual(["/v1/result/task"]);
    expect(
      progress.mock.calls.map(([value]) => [value.stage, value.percentage, value.source])
    ).toEqual([
      ["started", 25, "websocket"],
      ["completed", 100, "websocket"],
    ]);
  });

  it.each(["unavailable", "silent", "disconnected", "invalid-json"])(
    "falls back once to HTTP when WebSocket is %s",
    async (state) => {
      const complete = deferred<unknown>();
      const progress = vi.fn();
      const { tracker, ws, requests } = await fixture(
        {
          method: "hybrid",
          websocketTimeout: 100,
          onProgress: progress,
          onComplete: (value) => complete.resolve(value),
        },
        undefined,
        state !== "unavailable"
      );
      if (state === "disconnected") ws!.on("connection", (peer) => peer.close(1000, "closed"));
      if (state === "invalid-json") ws!.on("connection", (peer) => peer.send("broken json"));
      await tracker.startTracking("task");
      expect(await complete.promise).toEqual({ markdown: "result" });
      await wait();
      expect(requests).toEqual([
        ...(state === "unavailable" ? ["/v1/status/ws/task"] : []),
        "/v1/status/task",
        "/v1/result/task",
      ]);
      expect(progress).toHaveBeenCalledOnce();
    }
  );

  it("reports upstream task errors through WebSocket without waiting for polling", async () => {
    const error = deferred<Error>();
    const { tracker, ws, requests } = await fixture(
      { method: "websocket", onError: (value) => error.resolve(value) },
      undefined,
      true
    );
    ws!.on("connection", (peer) =>
      peer.send(JSON.stringify({ message: "error", error: "upstream task failed" }))
    );
    await tracker.startTracking("task");
    expect((await error.promise).message).toBe("upstream task failed");
    await wait();
    expect(requests).toEqual([]);
  });

  it("keeps resetting the inactivity timer on WebSocket progress", async () => {
    let remote!: WebSocket;
    const complete = deferred<unknown>();
    const { tracker, ws, requests } = await fixture(
      { method: "hybrid", websocketTimeout: 200, onComplete: (value) => complete.resolve(value) },
      undefined,
      true
    );
    ws!.on("connection", (peer) => {
      remote = peer;
    });
    await tracker.startTracking("task");
    for (let index = 0; index < 3; index++) {
      await wait(80);
      remote.send(
        JSON.stringify({ message: "update", task: { task_id: "task", task_status: "started" } })
      );
    }
    expect(requests).toEqual([]);
    expect(await complete.promise).toEqual({ markdown: "result" });
    expect(requests).toEqual(["/v1/status/task", "/v1/result/task"]);
  });

  it("cancels fallback and socket startup on stop and closes connected peers", async () => {
    const { tracker, ws, requests } = await fixture(
      { method: "hybrid", websocketTimeout: 20 },
      undefined,
      true
    );
    const pending = tracker.startTracking("first");
    await tracker.stopTracking();
    await pending;
    await wait(30);
    expect(requests).toEqual([]);
    expect(ws!.clients.size).toBe(0);
    await tracker.startTracking("second");
    await tracker.stopTracking();
    await wait(30);
    expect(ws!.clients.size).toBe(0);
    expect(requests).toEqual([]);
  });

  it.each(["unavailable", "disconnected"])(
    "reports WebSocket-only %s without polling or duplicate error callbacks",
    async (state) => {
      const gate = deferred<void>();
      const observed = deferred<void>();
      const seen = vi.fn(async () => {
        observed.resolve();
        await gate.promise;
      });
      const event = deferred<Error>();
      const { tracker, ws, requests } = await fixture(
        { method: "websocket", onError: seen },
        undefined,
        state !== "unavailable"
      );
      if (ws) ws.on("connection", (peer) => peer.close());
      tracker.on("error", (error) => event.resolve(error));
      const start = tracker.startTracking("task");
      await observed.promise;
      expect(seen).toHaveBeenCalledOnce();
      gate.resolve();
      await start;
      expect(await event.promise).toBeInstanceOf(Error);
      expect(requests).toEqual(state === "unavailable" ? ["/v1/status/ws/task"] : []);
    }
  );
});
