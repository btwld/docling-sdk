import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.doUnmock("ws");
});
it("reports an omitted optional ws package through the Node adapter's public connection", async () => {
  vi.resetModules();
  vi.doMock("ws", () => {
    throw new Error("package omitted");
  });
  const { NodeWebSocketAdapter } = await import("../../src/platform/websocket/adapters/node");
  await expect(new NodeWebSocketAdapter({ url: "ws://127.0.0.1:1" }).connect()).rejects.toThrow(
    "ws package is required"
  );
});
it("rejects use of the Node adapter in Bun before importing Node ws", async () => {
  vi.resetModules();
  vi.stubGlobal("Bun", { version: "fixture" });
  const { NodeWebSocketAdapter } = await import("../../src/platform/websocket/adapters/node");
  await expect(new NodeWebSocketAdapter({ url: "ws://127.0.0.1:1" }).connect()).rejects.toThrow(
    "only be used in Node"
  );
});
it("settles an invalid WebSocket URL without connecting or leaking a timer", async () => {
  const { NodeWebSocketAdapter } = await import("../../src/platform/websocket/adapters/node");
  const adapter = new NodeWebSocketAdapter({ url: "invalid URL", timeout: 10 });
  await expect(adapter.connect()).rejects.toThrow();
  expect(adapter.isConnected()).toBe(false);
  expect(adapter.getPeer()).toBeNull();
  adapter.close();
});
