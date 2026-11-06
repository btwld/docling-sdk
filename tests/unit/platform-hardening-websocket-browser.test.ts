import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserWebSocketAdapter,
  createBrowserWebSocketAdapter,
} from "../../src/platform/websocket/adapters/browser";
import { createWebSocketAdapter, CrossWebSocket } from "../../src/platform/websocket";
import type { WebSocketMessage } from "../../src/platform/websocket/types";

class NativeSocket extends EventTarget {
  static instances: NativeSocket[] = [];
  static autoOpen = false;
  readyState = 0;
  protocol = "docling";
  binaryType = "blob";
  sent: unknown[] = [];
  onopen?: (event: Event) => void;
  onmessage?: (event: MessageEvent) => void;
  onclose?: (event: { code: number; reason: string; wasClean: boolean }) => void;
  onerror?: (event: Event) => void;
  constructor(
    public url: string,
    public protocols?: string[]
  ) {
    super();
    NativeSocket.instances.push(this);
    if (NativeSocket.autoOpen) queueMicrotask(() => this.open());
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  message(data: unknown) {
    const event = new MessageEvent("message", { data });
    this.onmessage?.(event);
    this.dispatchEvent(event);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }
  fail() {
    this.readyState = 3;
    this.onerror?.(new Event("error"));
  }
}
const adapters: Array<{ close(): void }> = [];
function socket() {
  return NativeSocket.instances.at(-1)!;
}
beforeEach(() => {
  NativeSocket.instances = [];
  NativeSocket.autoOpen = false;
  vi.stubGlobal("WebSocket", NativeSocket);
});
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native WebSocket API adapter", () => {
  it("round trips text/binary messages and forwards peer event subscriptions", async () => {
    const messages: WebSocketMessage[] = [];
    const opened = vi.fn();
    const closed = vi.fn();
    const adapter = createBrowserWebSocketAdapter({
      url: "wss://example.test/ws",
      protocols: ["docling"],
      timeout: 500,
      hooks: { open: opened, message: (_peer, message) => messages.push(message), close: closed },
    });
    adapters.push(adapter);
    const connecting = adapter.connect();
    socket().open();
    const peer = await connecting;
    expect(adapter).toBeInstanceOf(BrowserWebSocketAdapter);
    expect(adapter.getType()).toBe("browser");
    expect(adapter.getPeer()).toBe(peer);
    expect(adapter.isConnected()).toBe(true);
    expect(peer.readyState).toBe(1);
    expect(peer.protocol).toBe("docling");
    expect(peer.url).toBe("wss://example.test/ws");
    expect(peer.getRaw()).toBe(socket());
    expect(opened).toHaveBeenCalledWith(peer);
    expect(socket().binaryType).toBe("arraybuffer");
    const subscribed = vi.fn();
    peer.subscribe("message", subscribed);
    socket().message('{"value":1}');
    socket().message(new Uint8Array([65, 66]).buffer);
    expect(messages[0]?.type).toBe("text");
    expect(messages[0]?.json()).toEqual({ value: 1 });
    expect(messages[0]?.binary()).toEqual(new TextEncoder().encode('{"value":1}'));
    expect(messages[1]?.type).toBe("binary");
    expect(messages[1]?.text()).toBe("AB");
    expect(messages[1]?.binary()).toEqual(new Uint8Array([65, 66]));
    peer.unsubscribe("message", subscribed);
    socket().message("extra");
    expect(subscribed).toHaveBeenCalledTimes(2);
    peer.send("a");
    peer.sendText("b");
    peer.sendBinary(new Uint8Array([67]));
    expect(socket().sent).toEqual(["a", "b", new Uint8Array([67])]);
    peer.close(1000, "finished");
    expect(closed).toHaveBeenCalledWith(peer, { code: 1000, reason: "finished", wasClean: true });
    expect(adapter.isConnected()).toBe(false);
    expect(() => peer.send("late")).toThrow("not open");
    peer.terminate();
    expect(closed).toHaveBeenLastCalledWith(
      peer,
      expect.objectContaining({ reason: "Terminated" })
    );
    adapter.close();
    expect(adapter.getPeer()).toBeNull();
  });

  it.each(["close", "error", "cancel", "timeout"])(
    "settles an unfinished handshake on %s and releases deadlines",
    async (failure) => {
      vi.useFakeTimers();
      const error = vi.fn();
      const close = vi.fn();
      const adapter = new BrowserWebSocketAdapter({
        url: "wss://example.test/ws",
        timeout: 10,
        hooks: { error, close },
      });
      adapters.push(adapter);
      const connecting = adapter.connect();
      const assertion = expect(connecting).rejects.toThrow();
      if (failure === "close") socket().close(1006, "early close");
      else if (failure === "error") socket().fail();
      else if (failure === "cancel") adapter.close();
      else await vi.advanceTimersByTimeAsync(10);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
      expect(adapter.isConnected()).toBe(false);
      if (failure === "error")
        expect(error).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ message: "WebSocket error" })
        );
    }
  );

  it("applies new hooks after connect and reports active connection errors", async () => {
    const adapter = new BrowserWebSocketAdapter({ url: "wss://example.test/ws" });
    adapters.push(adapter);
    const connecting = adapter.connect();
    socket().open();
    await connecting;
    const error = vi.fn();
    adapter.setHooks({ error });
    expect(adapter.getHooks()).toEqual({ error });
    socket().fail();
    expect(error).toHaveBeenCalledOnce();
    adapter.setHooks({});
    socket().message("ignored");
    socket().close();
  });

  it("rejects native constructor failure without leaving a deadline", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const adapter = new BrowserWebSocketAdapter({ url: "wss://example.test/ws", timeout: 10 });
    await expect(adapter.connect()).rejects.toThrow();
    expect(adapter.getPeer()).toBeNull();
  });

  it("selects native transport for Bun and declines unavailable implementations", async () => {
    vi.stubGlobal("Bun", { version: "fixture" });
    NativeSocket.autoOpen = true;
    const adapter = await createWebSocketAdapter({ url: "wss://example.test/ws" });
    adapters.push(adapter);
    expect(adapter.getType()).toBe("browser");
    const cross = new CrossWebSocket("wss://example.test/ws");
    adapters.push(cross);
    const old = vi.fn();
    cross.on("message", old).off("message");
    const opened = vi.fn();
    cross.setHooks({ open: opened });
    await cross.connect();
    expect(opened).toHaveBeenCalledOnce();
    expect(cross.getAdapterType()).toBe("browser");
    socket().message("ignored");
    expect(old).not.toHaveBeenCalled();
    cross.close();
    vi.stubGlobal("WebSocket", undefined);
    await expect(createWebSocketAdapter({ url: "wss://example.test/ws" })).rejects.toThrow(
      "No WebSocket implementation"
    );
  });
});
