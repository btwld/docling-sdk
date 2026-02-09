import { describe, it, expect, vi, beforeEach } from "vitest";
import { DoclingWebClient } from "../../../src/clients/web-client";
import type { DoclingWebClientConfig } from "../../../src/types/web";

describe("DoclingWebClient", () => {
  const defaultConfig: DoclingWebClientConfig = {
    type: "web",
  };

  describe("constructor", () => {
    it("creates client with default config", () => {
      const client = new DoclingWebClient(defaultConfig);
      expect(client.type).toBe("web");
      expect(client.ready).toBe(false);
      expect(client.processing).toBe(false);
    });

    it("creates client with custom config", () => {
      const client = new DoclingWebClient({
        type: "web",
        device: "wasm",
        modelId: "custom-model",
        maxNewTokens: 2048,
      });
      expect(client.type).toBe("web");
    });
  });

  describe("lifecycle", () => {
    it("starts as not ready", () => {
      const client = new DoclingWebClient(defaultConfig);
      expect(client.ready).toBe(false);
    });

    it("starts as not processing", () => {
      const client = new DoclingWebClient(defaultConfig);
      expect(client.processing).toBe(false);
    });

    it("destroy cleans up state", () => {
      const client = new DoclingWebClient(defaultConfig);
      client.destroy();
      expect(client.ready).toBe(false);
      expect(client.processing).toBe(false);
    });

    it("destroy can be called multiple times safely", () => {
      const client = new DoclingWebClient(defaultConfig);
      client.destroy();
      client.destroy(); // should not throw
      expect(client.ready).toBe(false);
    });
  });

  describe("events", () => {
    it("on returns this for chaining", () => {
      const client = new DoclingWebClient(defaultConfig);
      const result = client.on("error", () => {});
      expect(result).toBe(client);
    });

    it("off returns this for chaining", () => {
      const client = new DoclingWebClient(defaultConfig);
      const handler = () => {};
      client.on("error", handler);
      const result = client.off("error", handler);
      expect(result).toBe(client);
    });
  });

  describe("processImage", () => {
    it("throws if not initialized", async () => {
      const client = new DoclingWebClient(defaultConfig);
      await expect(
        client.processImage("data:image/png;base64,test")
      ).rejects.toThrow("Client not initialized");
    });
  });

  describe("convert", () => {
    it("throws if Worker is not available (Node.js environment)", async () => {
      const client = new DoclingWebClient(defaultConfig);
      // In Node.js, Worker is not available, so initialize will fail
      await expect(
        client.convert(new Uint8Array([1, 2, 3]), "test.pdf")
      ).rejects.toThrow();
    });
  });

  describe("DoclingClientBase methods", () => {
    let client: DoclingWebClient;

    beforeEach(() => {
      client = new DoclingWebClient(defaultConfig);
    });

    it("has type 'web'", () => {
      expect(client.type).toBe("web");
    });

    it("convertToFile throws not supported error", async () => {
      await expect(
        client.convertToFile(new Uint8Array([]), "test.pdf", {})
      ).rejects.toThrow("not supported");
    });

    it("safeConvertToFile throws not supported error", async () => {
      await expect(
        client.safeConvertToFile(new Uint8Array([]), "test.pdf", {})
      ).rejects.toThrow("not supported");
    });
  });

  describe("cache methods", () => {
    it("clearCache returns a promise", () => {
      const client = new DoclingWebClient(defaultConfig);
      // In Node.js, caches API is not available, so this will fail
      // Just verify the method exists and returns a promise
      const result = client.clearCache();
      expect(result).toBeInstanceOf(Promise);
      // Allow the promise to settle (will reject in Node)
      result.catch(() => {});
    });

    it("getCacheSize returns a promise", () => {
      const client = new DoclingWebClient(defaultConfig);
      const result = client.getCacheSize();
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });
});

describe("DoclingWebClient factory integration", () => {
  it("Docling factory creates web client with web config", async () => {
    // Dynamically import to test factory integration
    const { Docling } = await import("../../../src/docling");
    const { isWebConfig } = await import("../../../src/types/client");

    const config = { web: {} } as const;
    expect(isWebConfig(config)).toBe(true);

    const client = new Docling(config);
    expect(client.type).toBe("web");
    expect(client).toBeInstanceOf(DoclingWebClient);
  });

  it("isWebClient identifies web clients", async () => {
    const { isWebClient } = await import("../../../src/docling");
    const client = new DoclingWebClient({ type: "web" });
    expect(isWebClient(client)).toBe(true);
  });

  it("createWebClient creates a web client", async () => {
    const { createWebClient } = await import("../../../src/docling");
    const client = createWebClient({ device: "wasm" });
    expect(client.type).toBe("web");
    expect(client).toBeInstanceOf(DoclingWebClient);
  });
});
