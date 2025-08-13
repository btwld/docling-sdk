import { describe, it, expect } from "vitest";
import { HttpClient } from "../../src/api/http";
import type { ApiClientConfig } from "../../src/types/api";
import { TEST_CONSTANTS } from "../setup";

describe("HttpClient", () => {
  const mockConfig: ApiClientConfig = {
    baseUrl: TEST_CONSTANTS.MOCK_API_URL,
    timeout: 30000,
  };

  describe("constructor", () => {
    it("should create HTTP client with config", () => {
      const httpClient = new HttpClient(mockConfig);
      expect(httpClient).toBeInstanceOf(HttpClient);
    });

    it("should remove trailing slash from baseUrl", () => {
      const client = new HttpClient({ baseUrl: "http://localhost:5001/" });
      const config = client.getConfig();
      expect(config.baseUrl).toBe("http://localhost:5001");
    });

    it("should set default timeout if not provided", () => {
      const client = new HttpClient({ baseUrl: "http://localhost:5001" });
      const config = client.getConfig();
      expect(config.timeout).toBe(60000); // Default is 60000
    });

    it("should preserve custom timeout", () => {
      const client = new HttpClient({
        baseUrl: "http://localhost:5001",
        timeout: 30000,
      });
      const config = client.getConfig();
      expect(config.timeout).toBe(30000);
    });

    it("should throw error if baseUrl is missing", () => {
      expect(() => {
        new HttpClient({} as any);
      }).toThrow("baseUrl is required in ApiClientConfig");
    });
  });

  describe("getConfig", () => {
    it("should return current configuration", () => {
      const httpClient = new HttpClient(mockConfig);
      const config = httpClient.getConfig();
      expect(config.baseUrl).toBe(TEST_CONSTANTS.MOCK_API_URL);
      expect(config.timeout).toBe(30000);
      expect(config).toHaveProperty("headers");
      expect(config).toHaveProperty("retries");
      expect(config).toHaveProperty("retryDelay");
    });
  });
});
