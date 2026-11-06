import { afterEach, describe, expect, it, vi } from "vitest";
import * as binary from "../../src/platform/binary";
import * as runtime from "../../src/platform/detection";
import { createEventEmitter, CrossEventEmitter } from "../../src/platform/events";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("binary public helpers", () => {
  it("round trips Unicode, base64, hex, arrays and buffers", async () => {
    const bytes = binary.createBinary("Hi λ🌍");
    expect(binary.binaryToString(bytes)).toBe("Hi λ🌍");
    for (const encoding of ["base64", "hex"] as const) {
      expect(binary.createBinary(binary.binaryToString(bytes, encoding), encoding)).toEqual(bytes);
    }
    expect(binary.createBinary(bytes)).toBe(bytes);
    expect(binary.createBinary(new Uint8Array([1, 2]).buffer)).toEqual(new Uint8Array([1, 2]));
    expect(binary.createBinary([255, 0])).toEqual(new Uint8Array([255, 0]));
    expect(binary.createBinary(2)).toEqual(new Uint8Array(2));
    expect(binary.createBinary("0xCAfe", "hex")).toEqual(new Uint8Array([202, 254]));
    expect(binary.createBinary("", "hex")).toHaveLength(0);
    expect(() => binary.createBinary(null as never)).toThrow("Unsupported input");
    const buffer = Buffer.from([10, 20]);
    expect(binary.isNodeBuffer(buffer)).toBe(true);
    expect(binary.isNodeBuffer({})).toBe(false);
    expect(binary.isNodeBuffer(null)).toBe(false);
    expect(binary.isNodeBuffer("x")).toBe(false);
    expect(binary.bufferToUint8Array(buffer)).toBe(buffer);
    expect(() => binary.bufferToUint8Array({})).toThrow("Expected Buffer");
    expect(binary.isBinary(bytes)).toBe(true);
    expect(binary.isBinary("bytes")).toBe(false);
    const blob = binary.binaryToBlob(bytes);
    expect(blob.type).toBe("application/octet-stream");
    expect(await binary.blobToBinary(blob)).toEqual(bytes);
    expect(binary.binaryToBlob(bytes, "text/plain").type).toBe("text/plain");
    expect(await binary.streamToBinary(binary.binaryToStream(bytes))).toEqual(bytes);
  });

  it.each(["f", "0xabc", "fg", "gg", "01-2"])("rejects malformed hex %s", (value) => {
    expect(() => binary.hexToUint8Array(value)).toThrow();
  });

  it("keeps views inside the caller's slice and copies immutable slices", () => {
    const full = new Uint8Array([9, 1, 2, 8]);
    const input = full.subarray(1, 3);
    expect(binary.concatBinary(input, new Uint8Array([3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(binary.concatBinary()).toHaveLength(0);
    const view = binary.viewBinary(input, 1);
    view[0] = 7;
    expect(full).toEqual(new Uint8Array([9, 1, 7, 8]));
    const copy = binary.sliceBinary(input, 0, 1);
    copy[0] = 5;
    expect(input[0]).toBe(1);
    expect(binary.sliceBinary(input)).toEqual(input);
    expect(binary.equalsBinary(input, input.slice())).toBe(true);
    expect(binary.equalsBinary(input, new Uint8Array([1]))).toBe(false);
    expect(binary.equalsBinary(input, new Uint8Array([1, 2]))).toBe(false);
    for (const [offset, length] of [
      [-1, 1],
      [0, 3],
      [2, 1],
      [0.5, 1],
      [0, -1],
    ]) {
      expect(() => binary.viewBinary(input, offset!, length)).toThrow(RangeError);
    }
    expect(binary.viewBinary(input, 0, 1)).toEqual(new Uint8Array([1]));
    expect(binary.viewBinary(input, 2)).toHaveLength(0);
  });

  it("releases failed stream readers", async () => {
    const failure = new Error("source failed");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    });
    await expect(binary.streamToBinary(stream)).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
  });

  it("reports missing codecs truthfully", () => {
    vi.stubGlobal("atob", undefined);
    vi.stubGlobal("btoa", undefined);
    expect(() => binary.base64ToUint8Array("YQ==")).toThrow("not supported");
    expect(() => binary.uint8ArrayToBase64(new Uint8Array([1]))).toThrow("not supported");
  });

  it("produces RFC4122 v4 UUIDs across crypto capability levels", () => {
    const uuid = "12345678-1234-4234-8234-123456789abc";
    vi.stubGlobal("crypto", { randomUUID: () => uuid });
    expect(binary.randomUUID()).toBe(uuid);
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
    expect(binary.randomUUID()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    vi.stubGlobal("crypto", undefined);
    expect(binary.randomUUID()).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/
    );
  });
});

describe("runtime detection", () => {
  it("recognizes Node and available standard APIs", () => {
    expect(runtime.isNode()).toBe(true);
    expect(runtime.isServer()).toBe(true);
    expect(runtime.isBrowser()).toBe(false);
    expect(runtime.getRuntimeInfo()).toMatchObject({
      runtime: "node",
      version: process.versions.node,
    });
    expect(runtime.hasNativeFetch()).toBe(true);
    expect(runtime.hasWebStreams()).toBe(true);
    expect(runtime.hasAbortController()).toBe(true);
    expect(runtime.hasFormData()).toBe(true);
    expect(runtime.hasBlob()).toBe(true);
    expect(runtime.hasFile()).toBe(true);
  });

  it("prioritizes Bun and Deno over their Node compatibility globals", () => {
    vi.stubGlobal("Bun", { version: "1.2" });
    expect(runtime.isNode()).toBe(false);
    expect(runtime.getRuntimeInfo()).toMatchObject({ runtime: "bun", version: "1.2" });
    vi.stubGlobal("Bun", undefined);
    vi.stubGlobal("Deno", { version: { deno: "2.0" } });
    expect(runtime.isNode()).toBe(false);
    expect(runtime.isServer()).toBe(true);
    expect(runtime.getRuntimeInfo()).toMatchObject({ runtime: "deno", version: "2.0" });
  });

  it("detects browser and unknown worker runtimes without claiming server support", () => {
    const originalProcess = globalThis.process;
    try {
      vi.stubGlobal("process", undefined);
      vi.stubGlobal("window", {});
      vi.stubGlobal("document", {});
      expect(runtime.detectRuntime()).toBe("browser");
      expect(runtime.isBrowser()).toBe(true);
      expect(runtime.isServer()).toBe(false);
      vi.stubGlobal("document", undefined);
      expect(runtime.detectRuntime()).toBe("unknown");
      expect(runtime.getRuntimeInfo().version).toBeUndefined();
    } finally {
      vi.stubGlobal("process", originalProcess);
    }
  });

  it("reports absent features and present native WebSocket", () => {
    for (const key of [
      "fetch",
      "ReadableStream",
      "WritableStream",
      "AbortController",
      "FormData",
      "Blob",
      "File",
      "crypto",
      "WebSocket",
    ])
      vi.stubGlobal(key, undefined);
    expect(runtime.getRuntimeInfo().features).toEqual({
      nativeWebSocket: false,
      nativeFetch: false,
      webStreams: false,
      abortController: false,
      formData: false,
      blob: false,
      file: false,
      randomUUID: false,
    });
    vi.stubGlobal("ReadableStream", class {});
    expect(runtime.hasWebStreams()).toBe(false);
    vi.stubGlobal("WebSocket", class {});
    expect(runtime.hasNativeWebSocket()).toBe(true);
    vi.stubGlobal("crypto", { randomUUID: () => "id" });
    expect(runtime.hasRandomUUID()).toBe(true);
  });
});

describe("event emitter public contracts", () => {
  it("keeps once semantics, aliases, wildcard observers and listener ownership", () => {
    const events = createEventEmitter<{ a: number; b: string }>();
    expect(events).toBeInstanceOf(CrossEventEmitter);
    const seen = vi.fn();
    const once = vi.fn();
    const any = vi.fn();
    events.onAny(any).addListener("a", seen).once("a", once);
    expect(events.listenerCount("a")).toBe(2);
    expect(events.hasListeners("a")).toBe(true);
    expect(events.listeners("missing")).toEqual([]);
    events.emit("a", 1).emit("a", 2);
    expect(once.mock.calls).toEqual([[1]]);
    expect(seen.mock.calls).toEqual([[1], [2]]);
    expect(any.mock.calls).toEqual([
      ["a", 1],
      ["a", 2],
    ]);
    events.removeListener("a", seen).offAny(any);
    expect(events.listenerCount("a")).toBe(0);
    events.onAny(any).offAny().emit("b", "x");
    expect(any).toHaveBeenCalledTimes(2);
    events.offAny();
    events.on("a", seen).removeAllListeners("a");
    expect(events.hasListeners("a")).toBe(false);
    expect(events.eventNames()).toContain("a");
    expect(events.getRawEmitter().all).toBeInstanceOf(Map);
    events.removeAllListeners();
    expect(events.eventNames()).toEqual([]);
  });

  it("removes once listeners before a throwing handler can be re-entered", () => {
    const events = createEventEmitter();
    const fail = vi.fn(() => {
      throw new Error("observer failed");
    });
    events.once("x", fail);
    expect(() => events.emit("x", null)).toThrow("observer failed");
    events.emit("x", null);
    expect(fail).toHaveBeenCalledTimes(1);
  });
});
