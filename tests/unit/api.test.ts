import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DoclingAPIClient, HttpClient } from "../../src/api";
import type { ConvertDocumentsRequest, ApiClientConfig } from "../../src";

// Create a mock fetcher function
const mockFetcher = vi.fn();
mockFetcher.raw = vi.fn();

// Mock ofetch module with create function
vi.mock("ofetch", () => ({
  ofetch: Object.assign(vi.fn(), {
    create: vi.fn(() => mockFetcher),
    raw: vi.fn(),
  }),
  $fetch: vi.fn(),
  FetchError: class FetchError extends Error {
    statusCode?: number;
    data?: unknown;
  },
}));

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

// Test the S3 adapters
import {
  toOpenApiS3Source,
  toOpenApiS3Target,
  isUserFriendlyS3Config,
} from "../../src/types/adapters";

describe("S3 Adapters", () => {
  describe("toOpenApiS3Source", () => {
    it("should map user-friendly S3 config to API format", () => {
      const userConfig = {
        bucket: "my-bucket",
        key: "documents/file.pdf",
        region: "us-west-2",
        access_key_id: "AKIAIOSFODNN7EXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      };

      const result = toOpenApiS3Source(userConfig);

      expect(result.kind).toBe("s3");
      expect(result.bucket).toBe("my-bucket");
      expect(result.key_prefix).toBe("documents/file.pdf");
      expect(result.endpoint).toBe("s3.us-west-2.amazonaws.com");
      expect(result.access_key).toBe("AKIAIOSFODNN7EXAMPLE");
      expect(result.secret_key).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
      expect(result.verify_ssl).toBe(true);
    });

    it("should use custom endpoint when provided", () => {
      const userConfig = {
        bucket: "my-bucket",
        key: "file.pdf",
        endpoint: "minio.local:9000",
        access_key_id: "minio-access",
        secret_access_key: "minio-secret",
      };

      const result = toOpenApiS3Source(userConfig);

      expect(result.endpoint).toBe("minio.local:9000");
    });

    it("should throw error if credentials are missing", () => {
      const userConfig = {
        bucket: "my-bucket",
        key: "file.pdf",
        region: "us-west-2",
      };

      expect(() => toOpenApiS3Source(userConfig)).toThrow("AWS credentials are required");
    });

    it("should throw error if key is missing", () => {
      const userConfig = {
        bucket: "my-bucket",
        region: "us-west-2",
        access_key_id: "AKIAIOSFODNN7EXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      };

      expect(() => toOpenApiS3Source(userConfig)).toThrow("S3 key is required");
    });
  });

  describe("toOpenApiS3Target", () => {
    it("should map user-friendly S3 config to API target format", () => {
      const userConfig = {
        bucket: "output-bucket",
        key: "converted/",
        region: "us-west-2",
        access_key_id: "AKIAIOSFODNN7EXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      };

      const result = toOpenApiS3Target(userConfig);

      expect(result.kind).toBe("s3");
      expect(result.bucket).toBe("output-bucket");
      expect(result.key_prefix).toBe("converted/");
      expect(result.endpoint).toBe("s3.us-west-2.amazonaws.com");
    });

    it("should use empty string for key_prefix if key is not provided", () => {
      const userConfig = {
        bucket: "output-bucket",
        region: "us-west-2",
        access_key_id: "AKIAIOSFODNN7EXAMPLE",
        secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      };

      const result = toOpenApiS3Target(userConfig);

      expect(result.key_prefix).toBe("");
    });
  });

  describe("isUserFriendlyS3Config", () => {
    it("should return true for user-friendly config with region", () => {
      const config = { kind: "s3", region: "us-west-2", bucket: "my-bucket" };
      expect(isUserFriendlyS3Config(config)).toBe(true);
    });

    it("should return true for user-friendly config with access_key_id", () => {
      const config = {
        kind: "s3",
        access_key_id: "AKIAIOSFODNN7EXAMPLE",
        bucket: "my-bucket",
      };
      expect(isUserFriendlyS3Config(config)).toBe(true);
    });

    it("should return true for user-friendly config without endpoint", () => {
      const config = { kind: "s3", bucket: "my-bucket" };
      expect(isUserFriendlyS3Config(config)).toBe(true);
    });

    it("should return false for API format config with endpoint", () => {
      const config = {
        kind: "s3",
        endpoint: "s3.us-west-2.amazonaws.com",
        access_key: "key",
        secret_key: "secret",
        bucket: "my-bucket",
      };
      expect(isUserFriendlyS3Config(config)).toBe(false);
    });

    it("should return false for non-S3 config", () => {
      const config = { kind: "http", url: "https://example.com" };
      expect(isUserFriendlyS3Config(config)).toBe(false);
    });
  });
});
