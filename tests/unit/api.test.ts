import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DoclingAPIClient, HttpClient } from "../../src/api";
import type { ConvertDocumentsRequest, ApiClientConfig } from "../../src";

global.fetch = vi.fn();

describe("HttpClient", () => {
  let httpClient: HttpClient;
  const mockConfig: ApiClientConfig = {
    baseUrl: "http://localhost:5001",
    timeout: 30000,
  };

  beforeEach(() => {
    httpClient = new HttpClient(mockConfig);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("constructor", () => {
    it("should create HTTP client with config", () => {
      expect(httpClient).toBeInstanceOf(HttpClient);
    });

    it("should remove trailing slash from baseUrl", () => {
      const client = new HttpClient({ baseUrl: "http://localhost:5001/" });
      const config = client.getConfig();
      expect(config.baseUrl).toBe("http://localhost:5001");
    });
  });

  describe("request", () => {
    it("should make successful GET request", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ success: true }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const response = await httpClient.get("/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:5001/test",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );

      expect(response.data).toEqual({ success: true });
      expect(response.status).toBe(200);
    });

    it("should make successful POST request with JSON body", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ created: true }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const body = { test: "data" };
      const response = await httpClient.postJson("/test", body);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:5001/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(body),
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );

      expect(response.data).toEqual({ created: true });
    });

    it("should handle HTTP error responses", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ detail: "Resource not found" }),
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      await expect(httpClient.get("/nonexistent")).rejects.toThrow(
        "Resource not found"
      );
    });

    it("should handle network errors", async () => {
      (global.fetch as any).mockRejectedValue(new Error("Network error"));

      await expect(httpClient.get("/test")).rejects.toThrow("Network error");
    });

    it("should handle timeout", async () => {
      const abortError = new Error("Timeout");
      abortError.name = "AbortError";
      (global.fetch as any).mockRejectedValue(abortError);

      await expect(httpClient.get("/test")).rejects.toThrow("timed out");
    });
  });

  describe("parseHeaders", () => {
    it("should parse response headers", () => {
      const headers = new Headers({
        "content-type": "application/json",
        "x-custom-header": "test-value",
      });

      const parsed = (httpClient as any).parseHeaders(headers);

      expect(parsed).toEqual({
        "content-type": "application/json",
        "x-custom-header": "test-value",
      });
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", () => {
      httpClient.updateConfig({ timeout: 60000 });
      const config = httpClient.getConfig();
      expect(config.timeout).toBe(60000);
    });
  });
});

describe("DoclingAPIClient", () => {
  let apiClient: DoclingAPIClient;
  const mockConfig: ApiClientConfig = {
    baseUrl: "http://localhost:5001",
    timeout: 30000,
  };

  beforeEach(() => {
    apiClient = new DoclingAPIClient({
      type: "api",
      ...mockConfig,
    });
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create API client with config object", () => {
      expect(apiClient).toBeInstanceOf(DoclingAPIClient);
    });

    it("should create API client with string URL", () => {
      const client = new DoclingAPIClient("http://localhost:5001");
      expect(client).toBeInstanceOf(DoclingAPIClient);
    });
  });

  describe("validateConvertRequest", () => {
    it("should validate valid request with http source", () => {
      const request: ConvertDocumentsRequest = {
        sources: [{ kind: "http", url: "https://example.com/document.pdf" }],
        options: { to_formats: ["md"] },
      };

      // Access private method for testing without any
      const validateConvertRequest = (
        apiClient as unknown as { validateConvertRequest: (r: unknown) => void }
      ).validateConvertRequest.bind(apiClient as object);

      expect(() => validateConvertRequest(request)).not.toThrow();
    });

    it("should validate valid request with file source", () => {
      const request: ConvertDocumentsRequest = {
        sources: [
          {
            kind: "file",
            base64_string: "base64data",
            filename: "document.pdf",
          },
        ],
        options: { to_formats: ["md"] },
      };

      const validateConvertRequest = (
        apiClient as unknown as { validateConvertRequest: (r: unknown) => void }
      ).validateConvertRequest.bind(apiClient as object);

      expect(() => validateConvertRequest(request)).not.toThrow();
    });

    it("should reject request without sources", () => {
      const request = {
        options: { to_formats: ["md"] },
      } as ConvertDocumentsRequest;

      const validateConvertRequest =
        // expose private method via bracket access to avoid any
        (
          apiClient as unknown as {
            validateConvertRequest: (r: unknown) => void;
          }
        ).validateConvertRequest.bind(apiClient as object);

      expect(() => validateConvertRequest(request)).toThrow(
        "At least one source must be provided"
      );
    });

    it("should reject request with both source types (legacy)", () => {
      const request: any = {
        http_sources: [{ url: "https://example.com/document.pdf" }],
        file_sources: [
          { base64_string: "base64data", filename: "document.pdf" },
        ],
      };

      const validateConvertRequest = (
        apiClient as unknown as { validateConvertRequest: (r: unknown) => void }
      ).validateConvertRequest.bind(apiClient as object);

      // In the new model, only sources[] is supported; legacy fields are ignored.
      // So this should now fail with missing sources[], not the old dual-source error.
      expect(() => validateConvertRequest(request)).toThrow(
        "At least one source must be provided"
      );
    });

    it("should reject invalid URLs", () => {
      const request: ConvertDocumentsRequest = {
        sources: [{ kind: "http", url: "invalid-url" }],
      };

      const validateConvertRequest = (
        apiClient as unknown as { validateConvertRequest: (r: unknown) => void }
      ).validateConvertRequest.bind(apiClient as object);

      expect(() => validateConvertRequest(request)).toThrow("Invalid URL");
    });

    it("should reject incomplete file sources", () => {
      const request: ConvertDocumentsRequest = {
        sources: [{ kind: "file", base64_string: "base64data", filename: "" }],
      };

      const validateConvertRequest = (
        apiClient as any
      ).validateConvertRequest.bind(apiClient);

      expect(() => validateConvertRequest(request)).toThrow(
        "File sources must have base64_string and filename"
      );
    });
  });

  describe("prepareFiles", () => {
    it("should prepare Buffer files", async () => {
      const buffer = Buffer.from("test data");

      const prepareFiles = (apiClient as any).prepareFiles.bind(apiClient);
      const result = await prepareFiles(buffer);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "files",
        data: buffer,
        filename: "document_0",
        contentType: "application/octet-stream",
      });
    });

    it("should prepare multiple Buffer files", async () => {
      const buffers = [Buffer.from("test1"), Buffer.from("test2")];

      const prepareFiles = (apiClient as any).prepareFiles.bind(apiClient);
      const result = await prepareFiles(buffers);

      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe("document_0");
      expect(result[1].filename).toBe("document_1");
    });

    it("should handle unsupported file types", async () => {
      const prepareFiles = (apiClient as any).prepareFiles.bind(apiClient);

      await expect(prepareFiles("invalid")).rejects.toThrow(
        "Unsupported file type"
      );
    });
  });

  describe("normalizeError", () => {
    it("should normalize DoclingNetworkError", async () => {
      const { DoclingNetworkError } = await import("../../src/types");
      const error = new DoclingNetworkError("Network error", 500, {
        detail: "Server error",
      });

      const normalizeError = (apiClient as any).normalizeError.bind(apiClient);
      const normalized = normalizeError(error);

      expect(normalized).toEqual({
        message: "Network error",
        code: "NETWORK_ERROR",
        details: { detail: "Server error" },
      });
    });

    it("should normalize generic Error", () => {
      const error = new Error("Generic error");

      const normalizeError = (apiClient as any).normalizeError.bind(apiClient);
      const normalized = normalizeError(error);

      expect(normalized).toEqual({
        message: "Generic error",
        code: "Error",
        details: error,
      });
    });

    it("should normalize unknown error", () => {
      const error = "String error";

      const normalizeError = (apiClient as any).normalizeError.bind(apiClient);
      const normalized = normalizeError(error);

      expect(normalized).toEqual({
        message: "String error",
        code: "UNKNOWN_ERROR",
        details: error,
      });
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", () => {
      apiClient.updateConfig({ timeout: 60000 });
      const config = apiClient.getConfig();
      expect(config.timeout).toBe(60000);
    });
  });

  describe("getConfig", () => {
    it("should return current configuration", () => {
      const config = apiClient.getConfig();
      expect(config).toHaveProperty("baseUrl");
      expect(config).toHaveProperty("timeout");
    });
  });
});
