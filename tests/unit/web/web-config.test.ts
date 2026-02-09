import { describe, it, expect } from "vitest";
import {
  isAPIConfig,
  isCLIConfig,
  isWebConfig,
} from "../../../src/types/client";
import type { DoclingConfig } from "../../../src/types/client";

describe("isWebConfig", () => {
  it("returns true for web config", () => {
    const config: DoclingConfig = { web: {} };
    expect(isWebConfig(config)).toBe(true);
  });

  it("returns false for API config", () => {
    const config: DoclingConfig = { api: { baseUrl: "http://localhost:5000" } };
    expect(isWebConfig(config)).toBe(false);
  });

  it("returns false for CLI config", () => {
    const config: DoclingConfig = { cli: {} };
    expect(isWebConfig(config)).toBe(false);
  });

  it("config discriminants are mutually exclusive", () => {
    const webConfig: DoclingConfig = { web: { device: "webgpu" } };
    expect(isWebConfig(webConfig)).toBe(true);
    expect(isAPIConfig(webConfig)).toBe(false);
    expect(isCLIConfig(webConfig)).toBe(false);

    const apiConfig: DoclingConfig = { api: { baseUrl: "http://localhost:5000" } };
    expect(isAPIConfig(apiConfig)).toBe(true);
    expect(isWebConfig(apiConfig)).toBe(false);
    expect(isCLIConfig(apiConfig)).toBe(false);
  });
});

describe("DoclingConfig web variant", () => {
  it("accepts minimal web config", () => {
    const config: DoclingConfig = { web: {} };
    expect(config).toBeDefined();
    if (isWebConfig(config)) {
      expect(config.web).toBeDefined();
    }
  });

  it("accepts web config with all options", () => {
    const config: DoclingConfig = {
      web: {
        device: "webgpu",
        modelId: "custom-model",
        maxNewTokens: 8192,
        wasmPaths: { "test.wasm": "/path" },
        workerUrl: "/worker.js",
      },
    };
    expect(isWebConfig(config)).toBe(true);
    if (isWebConfig(config)) {
      expect(config.web.device).toBe("webgpu");
      expect(config.web.modelId).toBe("custom-model");
      expect(config.web.maxNewTokens).toBe(8192);
    }
  });

  it("accepts wasm device option", () => {
    const config: DoclingConfig = { web: { device: "wasm" } };
    if (isWebConfig(config)) {
      expect(config.web.device).toBe("wasm");
    }
  });

  it("accepts auto device option", () => {
    const config: DoclingConfig = { web: { device: "auto" } };
    if (isWebConfig(config)) {
      expect(config.web.device).toBe("auto");
    }
  });
});
