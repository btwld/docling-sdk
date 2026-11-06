import { once } from "node:events";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CrossWebSocket,
  connectWebSocket,
  createCrossWebSocket,
} from "../../src/platform/websocket";
import {
  NodeWebSocketAdapter,
  createNodeWebSocketAdapter,
} from "../../src/platform/websocket/adapters/node";
import { DoclingWebSocketClient, WebSocketAsyncTask } from "../../src/clients/websocket-client";
import type { WebSocketMessage, WebSocketPeer } from "../../src/platform/websocket/types";

const servers: WebSocketServer[] = [];
const cleanup: Array<() => void> = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function server() {
  const result = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.push(result);
  await once(result, "listening");
  const address = result.address();
  if (!address || typeof address === "string") throw new Error("expected port");
  return { server: result, url: `ws://127.0.0.1:${address.port}` };
}
function task(task_status = "success", task_id = "task") {
  return {
    message: "update",
    task: { task_id, task_status, task_position: 2, task_meta: { fixture: true } },
  };
}
async function wait(ms = 25) {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

afterEach(async () => {
  for (const close of cleanup.splice(0)) close();
  for (const ws of servers.splice(0)) {
    for (const peer of ws.clients) peer.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Node WebSocket transport against a loopback ws server", () => {
  it("preserves text and binary frame kinds, JSON and peer operations", async () => {
    const fixture = await server();
    fixture.server.on("connection", (socket) => {
      socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
      socket.on("ping", (data) => socket.pong(data));
    });
    const messages: WebSocketMessage[] = [];
    const incoming = deferred<void>();
    const pong = deferred<void>();
    const adapter = createNodeWebSocketAdapter({
      url: fixture.url,
      protocols: ["docling"],
      timeout: 500,
      hooks: {
        message: (_peer, message) => {
          messages.push(message);
          if (messages.length === 3) incoming.resolve();
        },
        pong: () => pong.resolve(),
      },
    });
    cleanup.push(() => adapter.close());
    const peer = await adapter.connect();
    expect(adapter).toBeInstanceOf(NodeWebSocketAdapter);
    expect(adapter.getPeer()).toBe(peer);
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getType()).toBe("node");
    expect(peer.readyState).toBe(1);
    expect(peer.protocol).toBe("docling");
    expect(peer.id).toMatch(/^[\da-f-]{36}$/);
    expect(peer.url).toBe(fixture.url);
    expect(peer.getRaw()).toBeInstanceOf(WebSocket);
    const subscribed = vi.fn();
    peer.subscribe("message", subscribed);
    peer.sendText('{"kind":"text"}');
    peer.sendBinary(new Uint8Array([7, 8]));
    peer.send("plain");
    peer.ping!(new Uint8Array([9]));
    peer.pong!(new Uint8Array([9]));
    await Promise.all([incoming.promise, pong.promise]);
    expect(messages[0]?.type).toBe("text");
    expect(messages[0]?.data).toBe('{"kind":"text"}');
    expect(messages[0]?.json()).toEqual({ kind: "text" });
    expect([...messages[0]!.binary()]).toEqual([...new TextEncoder().encode('{"kind":"text"}')]);
    expect(messages[1]?.type).toBe("binary");
    expect([...messages[1]!.binary()]).toEqual([7, 8]);
    expect(messages[2]?.text()).toBe("plain");
    expect(subscribed).toHaveBeenCalledTimes(3);
    peer.unsubscribe("message", subscribed);
    const close = deferred<void>();
    adapter.setHooks({ close: () => close.resolve() });
    expect(adapter.getHooks()).toHaveProperty("close");
    peer.close(1000, "finished");
    await close.promise;
    expect(adapter.isConnected()).toBe(false);
    expect(() => peer.sendText("late")).toThrow("not open");
    peer.terminate();
  });

  it("exposes cross-runtime helpers, live hook updates and safe disconnected sends", async () => {
    const fixture = await server();
    fixture.server.on("connection", (socket) =>
      socket.on("message", (data) => socket.send(data.toString()))
    );
    const cross = createCrossWebSocket(fixture.url, { timeout: 500 });
    cleanup.push(() => cross.close());
    expect(cross.getAdapterType()).toBeNull();
    expect(cross.getAdapter()).toBeNull();
    expect(cross.getPeer()).toBeNull();
    expect(cross.isConnected()).toBe(false);
    expect(() => cross.send("early")).toThrow("not connected");
    expect(() => cross.sendText("early")).toThrow("not connected");
    const first = cross.connect();
    const second = cross.connect();
    const [peer, same] = await Promise.all([first, second]);
    expect(peer).toBe(same);
    expect(await cross.connect()).toBe(peer);
    expect(cross.getAdapterType()).toBe("node");
    expect(cross.getAdapter()).toBeInstanceOf(NodeWebSocketAdapter);
    const text = deferred<WebSocketMessage>();
    cross.on("message", (_peer, message) => text.resolve(message));
    cross.sendJson({ text: "hello" });
    expect((await text.promise).json()).toEqual({ text: "hello" });
    cross.off("message");
    const binary = deferred<WebSocketMessage>();
    cross.setHooks({ message: (_peer, message) => binary.resolve(message) });
    cross.send(new Uint8Array([65]));
    expect((await binary.promise).text()).toBe("A");
    const peer2 = await connectWebSocket(fixture.url);
    cleanup.push(() => peer2.close());
    expect(peer2.readyState).toBe(1);
  });

  it("settles failed connections even when ws has already changed to CLOSED", async () => {
    const fixture = await server();
    const url = fixture.url;
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    servers.pop();
    const adapter = new NodeWebSocketAdapter({ url, timeout: 100 });
    cleanup.push(() => adapter.close());
    await expect(adapter.connect()).rejects.toThrow();
    const cross = new CrossWebSocket(url, { timeout: 100 });
    cleanup.push(() => cross.close());
    await expect(cross.connect()).rejects.toThrow();
    await expect(cross.connect()).rejects.toThrow();
  });

  it("cancels lazy connection setup before any socket is created", async () => {
    const fixture = await server();
    const connections = vi.fn();
    fixture.server.on("connection", connections);
    const cross = new CrossWebSocket(fixture.url);
    const promise = cross.connect();
    cross.close();
    await expect(promise).rejects.toThrow("canceled");
    const adapter = new NodeWebSocketAdapter({ url: fixture.url });
    const pending = adapter.connect();
    adapter.close();
    await expect(pending).rejects.toThrow("canceled");
    await wait();
    expect(connections).not.toHaveBeenCalled();
  });

  it("times out and cancels sockets stalled during HTTP upgrade", async () => {
    const fixture = await server();
    fixture.server.on("headers", () => {});
    // verifyClient can hold the real network handshake without replacing SDK transport.
    const raw = createServer();
    const rawSockets = new Set<Socket>();
    raw.on("connection", (socket) => {
      rawSockets.add(socket);
      socket.on("close", () => rawSockets.delete(socket));
    });
    const held = new WebSocketServer({ server: raw, verifyClient: (_info, _done) => {} });
    servers.push(held);
    cleanup.push(() => {
      for (const socket of rawSockets) socket.destroy();
      raw.close();
    });
    raw.listen(0, "127.0.0.1");
    await once(raw, "listening");
    const address = raw.address();
    if (!address || typeof address === "string") throw new Error("expected port");
    const url = `ws://127.0.0.1:${address.port}`;
    const adapter = new NodeWebSocketAdapter({ url, timeout: 15 });
    cleanup.push(() => adapter.close());
    await expect(adapter.connect()).rejects.toThrow("timeout");
    const canceled = new NodeWebSocketAdapter({ url, timeout: 500 });
    cleanup.push(() => canceled.close());
    const promise = canceled.connect();
    const assertion = expect(promise).rejects.toThrow("canceled");
    await wait(5);
    canceled.close();
    await assertion;
  });
});

describe("Docling WebSocket monitoring", () => {
  it("normalizes URLs, preserves explicit zero options and encodes task IDs", async () => {
    const fixture = await server();
    const request = deferred<string>();
    fixture.server.on("connection", (_socket, incoming) => request.resolve(incoming.url!));
    const sdk = new DoclingWebSocketClient({
      baseUrl: `${fixture.url.replace("ws:", "http:")}/`,
      reconnectAttempts: 0,
      reconnectDelay: 0,
      heartbeatInterval: 0,
    });
    cleanup.push(() => sdk.disconnect());
    expect(sdk.getConfig()).toMatchObject({
      baseUrl: fixture.url,
      reconnectAttempts: 0,
      reconnectDelay: 0,
      heartbeatInterval: 0,
    });
    const connecting = sdk.connectToTask("id/with space");
    const again = sdk.connectToTask("id/with space");
    expect(again).toBe(connecting);
    await connecting;
    expect(await request.promise).toBe("/v1/status/ws/id%2Fwith%20space");
    expect(sdk.getCurrentTaskId()).toBe("id/with space");
    expect(sdk.isConnected()).toBe(true);
    expect(sdk.getConnectionState()).toBe("connected");
    await sdk.connectToTask("id/with space");
    sdk.updateConfig({ baseUrl: "https://example.test/", reconnectAttempts: 0 });
    expect(sdk.getConfig().baseUrl).toBe("wss://example.test");
    sdk.updateConfig({ heartbeatInterval: 100 });
    const config = sdk.getConfig();
    config.baseUrl = "modified";
    expect(sdk.getConfig().baseUrl).toBe("wss://example.test");
    sdk.disconnect();
    expect(sdk.getCurrentTaskId()).toBeNull();
    expect(sdk.getConnectionState()).toBe("disconnected");
  });

  it("emits every task event, filters unrelated task updates and preserves external observers", async () => {
    const fixture = await server();
    let remote!: WebSocket;
    fixture.server.on("connection", (socket) => {
      remote = socket;
    });
    const sdk = new DoclingWebSocketClient({ baseUrl: fixture.url, heartbeatInterval: 0 });
    cleanup.push(() => sdk.disconnect());
    const observer = vi.fn();
    const progress = vi.fn();
    const taskEvents = vi.fn();
    sdk.on("task_update", observer).onAny(taskEvents);
    const first = sdk.monitorTask("task", progress);
    const second = sdk.monitorTask("task");
    const connected = deferred<void>();
    sdk.on("connected", () => connected.resolve());
    await connected.promise;
    for (const message of [
      { message: "connection" },
      { message: "update" },
      task("success", "other"),
      task("pending"),
      task("started"),
      { message: "unknown" },
      task(),
    ])
      remote.send(JSON.stringify(message));
    expect((await first).task_status).toBe("success");
    expect((await second).task_id).toBe("task");
    expect(progress.mock.calls.map(([update]) => update.percentage)).toEqual([0, 25, 100]);
    expect(observer).toHaveBeenCalledTimes(4);
    expect(sdk.listenerCount("task_update")).toBe(1);
    expect(sdk.listenerCount("error")).toBe(0);
    expect(taskEvents.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        "connection",
        "taskStarted",
        "taskComplete",
        "unknownMessage",
        "status",
        "progress",
      ])
    );
  });

  it.each(["failure", "invalid-json", "callback", "disconnect"])(
    "settles monitor promises and removes only owned listeners on %s",
    async (outcome) => {
      const fixture = await server();
      let remote!: WebSocket;
      fixture.server.on("connection", (socket) => {
        remote = socket;
      });
      const sdk = new DoclingWebSocketClient({ baseUrl: fixture.url, heartbeatInterval: 0 });
      cleanup.push(() => sdk.disconnect());
      const external = vi.fn();
      sdk.on("error", external);
      const result = sdk.monitorTask(
        "task",
        outcome === "callback"
          ? () => {
              throw new Error("callback failed");
            }
          : undefined
      );
      const assertion = expect(result).rejects.toThrow();
      const connected = deferred<void>();
      sdk.on("connected", () => connected.resolve());
      await connected.promise;
      if (outcome === "disconnect") sdk.disconnect();
      else
        remote.send(
          outcome === "invalid-json"
            ? "not json"
            : JSON.stringify(task(outcome === "failure" ? "failure" : "success"))
        );
      await assertion;
      expect(sdk.listenerCount("task_update")).toBe(0);
      expect(sdk.listenerCount("error")).toBe(1);
      expect(sdk.listenerCount("disconnected")).toBe(0);
    }
  );

  it("reconnects after abnormal closure, sends heartbeat and cancels scheduled reconnection", async () => {
    const fixture = await server();
    const sockets: WebSocket[] = [];
    const ping = deferred<void>();
    fixture.server.on("connection", (socket) => {
      sockets.push(socket);
      socket.on("message", (data) => {
        if (data.toString() === '{"type":"ping"}') ping.resolve();
      });
    });
    const sdk = new DoclingWebSocketClient({
      baseUrl: fixture.url,
      reconnectDelay: 5,
      reconnectAttempts: 2,
      heartbeatInterval: 5,
    });
    cleanup.push(() => sdk.disconnect());
    await sdk.connectToTask("task");
    await ping.promise;
    const reconnected = deferred<void>();
    sdk.on("connected", () => reconnected.resolve());
    const reconnecting = vi.fn();
    sdk.on("reconnecting", reconnecting);
    sockets[0]!.terminate();
    await reconnected.promise;
    expect(sockets).toHaveLength(2);
    expect(reconnecting).toHaveBeenCalledWith({ attempt: 1, delay: 5 });
    sdk.on("reconnecting", () => sdk.disconnect());
    sockets[1]!.terminate();
    await wait(30);
    expect(sockets).toHaveLength(2);
    expect(sdk.getConnectionState()).toBe("disconnected");
  });

  it("does not reconnect with zero attempts or after an explicit disconnect during connect", async () => {
    const fixture = await server();
    const sockets: WebSocket[] = [];
    fixture.server.on("connection", (socket) => sockets.push(socket));
    const sdk = new DoclingWebSocketClient({
      baseUrl: fixture.url,
      reconnectAttempts: 0,
      reconnectDelay: 1,
      heartbeatInterval: 0,
    });
    cleanup.push(() => sdk.disconnect());
    await sdk.connectToTask("task");
    sockets[0]!.terminate();
    await wait();
    expect(sockets).toHaveLength(1);
    expect(sdk.getConnectionState()).toBe("disconnected");
    const connecting = sdk.connectToTask("replacement");
    sdk.disconnect();
    await expect(connecting).rejects.toThrow("canceled");
    await wait();
    expect(sockets).toHaveLength(1);
  });

  it.each(["abnormal-close", "server-error"])(
    "settles monitoring on %s when no further update can arrive",
    async (outcome) => {
      const fixture = await server();
      let remote!: WebSocket;
      fixture.server.on("connection", (socket) => {
        remote = socket;
      });
      const sdk = new DoclingWebSocketClient({
        baseUrl: fixture.url,
        reconnectAttempts: 0,
        heartbeatInterval: 0,
      });
      cleanup.push(() => sdk.disconnect());
      const pending = sdk.monitorTask("task");
      const assertion = expect(pending).rejects.toThrow();
      await new Promise<void>((resolve) => sdk.once("connected", () => resolve()));
      if (outcome === "abnormal-close") remote.terminate();
      else remote.send(JSON.stringify({ message: "error", error: "task could not process" }));
      await assertion;
      expect(sdk.listenerCount("task_update")).toBe(0);
      expect(sdk.listenerCount("taskError")).toBe(0);
    }
  );

  it("bounds failed reconnections and reports the actual attempt number", async () => {
    const fixture = await server();
    let remote!: WebSocket;
    fixture.server.on("connection", (socket) => {
      remote = socket;
    });
    const sdk = new DoclingWebSocketClient({
      baseUrl: fixture.url,
      reconnectAttempts: 2,
      reconnectDelay: 5,
      heartbeatInterval: 0,
    });
    cleanup.push(() => sdk.disconnect());
    const attempts = vi.fn();
    const failures: number[] = [];
    const done = deferred<void>();
    sdk.on("reconnecting", attempts).on("reconnectFailed", ({ attempt }) => {
      failures.push(attempt);
      if (failures.length === 2) done.resolve();
    });
    await sdk.connectToTask("task");
    remote.terminate();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    servers.pop();
    await done.promise;
    await wait();
    expect(attempts.mock.calls).toEqual([[{ attempt: 1, delay: 5 }], [{ attempt: 2, delay: 10 }]]);
    expect(failures).toEqual([1, 2]);
    expect(sdk.isConnected()).toBe(false);
  });

  it("allows replacing an active monitored task without canceling the new waiter", async () => {
    const fixture = await server();
    const sockets: WebSocket[] = [];
    fixture.server.on("connection", (socket) => sockets.push(socket));
    const sdk = new DoclingWebSocketClient({ baseUrl: fixture.url, heartbeatInterval: 0 });
    cleanup.push(() => sdk.disconnect());
    const old = sdk.monitorTask("old");
    const oldAssertion = expect(old).rejects.toThrow("disconnected");
    await new Promise<void>((resolve) => sdk.once("connected", () => resolve()));
    const next = sdk.monitorTask("next");
    await new Promise<void>((resolve) => sdk.once("connected", () => resolve()));
    sockets[1]!.send(JSON.stringify(task("success", "next")));
    expect((await next).task_id).toBe("next");
    await oldAssertion;
  });

  it("cancels directly from a connecting observer without starting a socket", async () => {
    const fixture = await server();
    const connections = vi.fn();
    fixture.server.on("connection", connections);
    const sdk = new DoclingWebSocketClient({ baseUrl: fixture.url });
    sdk.on("connecting", () => sdk.disconnect());
    await expect(sdk.connectToTask("task")).rejects.toThrow("canceled");
    await wait();
    expect(connections).not.toHaveBeenCalled();
    expect(sdk.getConnectionState()).toBe("disconnected");
  });

  it("reports async task failures once, filters unrelated tasks and forwards processing errors", async () => {
    const fixture = await server();
    let socket!: WebSocket;
    fixture.server.on("connection", (peer) => {
      socket = peer;
    });
    const asyncTask = new WebSocketAsyncTask("task", "pending", undefined, undefined, {
      baseUrl: fixture.url,
      heartbeatInterval: 0,
    });
    cleanup.push(() => asyncTask.stopMonitoring());
    const error = vi.fn();
    const progress = vi.fn();
    const failed = deferred<void>();
    asyncTask
      .on("error", error)
      .on("progress", progress)
      .on("failed", () => failed.resolve());
    await asyncTask.startMonitoring();
    socket.send(JSON.stringify(task("failure", "other")));
    socket.send(JSON.stringify(task("success", "other")));
    socket.send(JSON.stringify({ message: "error", error: "processing failed" }));
    socket.send(JSON.stringify(task("failure")));
    await failed.promise;
    expect(progress).toHaveBeenCalledOnce();
    expect(asyncTask.status).toBe("failure");
    expect(error).toHaveBeenCalledOnce();
    expect(asyncTask.isCurrentlyMonitoring()).toBe(false);
  });

  it("rejects unavailable async task startup with one error notification", async () => {
    const fixture = await server();
    const url = fixture.url;
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    servers.pop();
    const asyncTask = new WebSocketAsyncTask("task", "pending", undefined, undefined, {
      baseUrl: url,
      reconnectAttempts: 0,
    });
    cleanup.push(() => asyncTask.stopMonitoring());
    const error = vi.fn();
    asyncTask.on("error", error);
    await expect(asyncTask.startMonitoring()).rejects.toThrow();
    expect(error).toHaveBeenCalledOnce();
    expect(asyncTask.isCurrentlyMonitoring()).toBe(false);
  });

  it("tracks WebSocketAsyncTask status and stops on terminal updates", async () => {
    const fixture = await server();
    let socket!: WebSocket;
    fixture.server.on("connection", (peer) => {
      socket = peer;
    });
    const asyncTask = new WebSocketAsyncTask("task", "pending", undefined, undefined, {
      baseUrl: fixture.url,
      heartbeatInterval: 0,
    });
    cleanup.push(() => asyncTask.stopMonitoring());
    const complete = deferred<void>();
    const progress = vi.fn();
    asyncTask.on("complete", () => complete.resolve()).on("progress", progress);
    await asyncTask.startMonitoring();
    await asyncTask.startMonitoring();
    expect(asyncTask.isCurrentlyMonitoring()).toBe(true);
    socket.send(JSON.stringify(task()));
    await complete.promise;
    expect(asyncTask.status).toBe("success");
    expect(asyncTask.position).toBe(2);
    expect(asyncTask.meta).toEqual({ fixture: true });
    expect(progress).toHaveBeenCalledOnce();
    expect(asyncTask.isCurrentlyMonitoring()).toBe(false);
    expect(asyncTask.getWebSocketClient().getConnectionState()).toBe("disconnected");
    expect(() => new WebSocketAsyncTask("id", "pending")).toThrow("configuration");
  });

  it("stops a WebSocketAsyncTask even while startup is pending", async () => {
    const fixture = await server();
    const asyncTask = new WebSocketAsyncTask("task", "pending", undefined, undefined, {
      baseUrl: fixture.url,
    });
    const pending = asyncTask.startMonitoring();
    asyncTask.stopMonitoring();
    await pending;
    expect(asyncTask.isCurrentlyMonitoring()).toBe(false);
  });
});
