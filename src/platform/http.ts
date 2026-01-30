/**
 * Cross-runtime HTTP client based on ofetch
 * Provides a unified HTTP interface for all runtime environments
 */

import { $fetch, ofetch, type FetchOptions, type FetchError } from "ofetch";
import type {
  HttpClientConfig,
  HttpResponse,
  ExtendedHttpOptions,
  FileUploadInfo,
  UploadProgress,
} from "./types";
import {
  binaryToBlob,
  uint8ArrayToString,
  type BinaryData,
} from "./binary";

/**
 * Default retry status codes
 */
const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Cross-runtime HTTP client
 */
export class PlatformHttpClient {
  private config: Required<HttpClientConfig>;
  private fetcher: typeof $fetch;

  constructor(config: HttpClientConfig) {
    if (!config.baseUrl) {
      throw new Error("baseUrl is required in HttpClientConfig");
    }

    this.config = {
      baseUrl: config.baseUrl.endsWith("/") ? config.baseUrl.slice(0, -1) : config.baseUrl,
      timeout: config.timeout ?? 60000,
      headers: config.headers ?? {},
      retry: config.retry ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      retryStatusCodes: config.retryStatusCodes ?? DEFAULT_RETRY_STATUS_CODES,
    };

    // Create a custom ofetch instance with base configuration
    this.fetcher = ofetch.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: this.config.headers,
      retry: this.config.retry,
      retryDelay: this.config.retryDelay,
      retryStatusCodes: this.config.retryStatusCodes,
    });
  }

  /**
   * Make an HTTP request
   */
  async request<T = unknown>(
    endpoint: string,
    options: ExtendedHttpOptions = {}
  ): Promise<HttpResponse<T>> {
    const url = endpoint.startsWith("http") ? endpoint : endpoint;

    // biome-ignore lint/suspicious/noExplicitAny: ofetch interceptors have complex generic types
    const fetchOptions: FetchOptions<any> = {
      method: options.method ?? "GET",
      headers: {
        ...this.config.headers,
        ...options.headers,
      },
      timeout: options.timeout ?? this.config.timeout,
      retry: options.retry ?? this.config.retry,
      retryDelay: options.retryDelay ?? this.config.retryDelay,
      retryStatusCodes: options.retryStatusCodes ?? this.config.retryStatusCodes,
      signal: options.signal,
      query: options.query,
      parseResponse: options.parseResponse !== false ? JSON.parse : undefined,
      ignoreResponseError: options.ignoreResponseError,
      // Cast interceptors to any to bypass ofetch's complex generic types
      onRequest: options.onRequest as FetchOptions["onRequest"],
      onResponse: options.onResponse as FetchOptions["onResponse"],
      onRequestError: options.onRequestError as FetchOptions["onRequestError"],
      onResponseError: options.onResponseError as FetchOptions["onResponseError"],
    };

    // Handle body
    if (options.body !== undefined) {
      if (options.body instanceof FormData) {
        fetchOptions.body = options.body;
        // Let ofetch handle Content-Type for FormData
        const headers = fetchOptions.headers as Record<string, string>;
        headers["Content-Type"] = undefined as unknown as string;
      } else if (options.body instanceof ReadableStream) {
        fetchOptions.body = options.body;
      } else if (typeof options.body === "string") {
        fetchOptions.body = options.body;
      } else if (options.body instanceof Uint8Array) {
        fetchOptions.body = options.body;
      } else {
        // Object - serialize to JSON
        fetchOptions.body = JSON.stringify(options.body);
        (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
      }
    }

    // Handle response type
    if (options.responseType === "binary") {
      fetchOptions.responseType = "arrayBuffer";
    } else if (options.responseType === "text") {
      fetchOptions.responseType = "text";
    } else if (options.responseType === "stream") {
      fetchOptions.responseType = "stream";
    }

    try {
      // biome-ignore lint/suspicious/noExplicitAny: ofetch has complex response type generics
      const response = await this.fetcher.raw<T>(url, fetchOptions as FetchOptions<any>);

      // Parse response headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Handle binary response
      let data: T;
      if (options.responseType === "binary" && response._data instanceof ArrayBuffer) {
        data = new Uint8Array(response._data) as unknown as T;
      } else {
        data = response._data as T;
      }

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers,
        _raw: response,
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * GET request
   */
  async get<T = unknown>(
    endpoint: string,
    options: Omit<ExtendedHttpOptions, "method"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  /**
   * POST request
   */
  async post<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<ExtendedHttpOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: "POST", body: body as ExtendedHttpOptions["body"] });
  }

  /**
   * PUT request
   */
  async put<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<ExtendedHttpOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: "PUT", body: body as ExtendedHttpOptions["body"] });
  }

  /**
   * DELETE request
   */
  async delete<T = unknown>(
    endpoint: string,
    options: Omit<ExtendedHttpOptions, "method"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }

  /**
   * GET request expecting JSON response
   */
  async getJson<T = unknown>(
    endpoint: string,
    options: Omit<ExtendedHttpOptions, "method" | "responseType"> = {}
  ): Promise<HttpResponse<T>> {
    return this.get<T>(endpoint, { ...options, responseType: "json" });
  }

  /**
   * POST request expecting JSON response
   */
  async postJson<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<ExtendedHttpOptions, "method" | "body" | "responseType"> = {}
  ): Promise<HttpResponse<T>> {
    return this.post<T>(endpoint, body, { ...options, responseType: "json" });
  }

  /**
   * PUT request expecting JSON response
   */
  async putJson<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<ExtendedHttpOptions, "method" | "body" | "responseType"> = {}
  ): Promise<HttpResponse<T>> {
    return this.put<T>(endpoint, body, { ...options, responseType: "json" });
  }

  /**
   * DELETE request expecting JSON response
   */
  async deleteJson<T = unknown>(
    endpoint: string,
    options: Omit<ExtendedHttpOptions, "method" | "responseType"> = {}
  ): Promise<HttpResponse<T>> {
    return this.delete<T>(endpoint, { ...options, responseType: "json" });
  }

  /**
   * GET request expecting binary response
   */
  async getBytes(
    endpoint: string,
    options: Omit<ExtendedHttpOptions, "method" | "responseType"> = {}
  ): Promise<HttpResponse<Uint8Array>> {
    return this.get<Uint8Array>(endpoint, { ...options, responseType: "binary" });
  }

  /**
   * GET request expecting text response
   */
  async getText(
    endpoint: string,
    options: Omit<ExtendedHttpOptions, "method" | "responseType"> = {}
  ): Promise<HttpResponse<string>> {
    return this.get<string>(endpoint, { ...options, responseType: "text" });
  }

  /**
   * Upload files using multipart form data
   */
  async uploadFiles<T = unknown>(
    endpoint: string,
    files: FileUploadInfo[],
    fields: Record<string, unknown> = {},
    options: Omit<ExtendedHttpOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    const formData = new FormData();

    // Add form fields
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          formData.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }

    // Add files
    for (const file of files) {
      let blob: Blob;

      if (typeof file.data === "string") {
        blob = new Blob([file.data], {
          type: file.contentType ?? "text/plain",
        });
      } else {
        blob = binaryToBlob(file.data, file.contentType ?? "application/octet-stream");
      }

      formData.append(file.name, blob, file.filename ?? "file");
    }

    return this.post<T>(endpoint, formData, options);
  }

  /**
   * Stream upload with progress tracking
   */
  async streamUpload<T = unknown>(
    endpoint: string,
    files: Array<{
      name: string;
      data: BinaryData | ReadableStream<Uint8Array>;
      filename?: string;
      contentType?: string;
      size?: number;
    }>,
    fields: Record<string, unknown> = {},
    options: {
      onProgress?: (progress: UploadProgress) => void;
      chunkSize?: number;
    } & Omit<ExtendedHttpOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    const { onProgress, chunkSize = 64 * 1024, ...requestOptions } = options;

    // Calculate total bytes
    const totalBytes = files.reduce((total, file) => {
      if (file.size) return total + file.size;
      if (file.data instanceof Uint8Array) return total + file.data.length;
      return total;
    }, 0);

    let uploadedBytes = 0;

    onProgress?.({
      uploadedBytes: 0,
      totalBytes,
      percentage: 0,
      currentFile: files[0]?.filename ?? "unknown",
      stage: "preparing",
    });

    const formData = new FormData();

    // Add fields
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          formData.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }

    // Add files
    for (const file of files) {
      const filename = file.filename ?? "file";
      let fileData: Uint8Array;

      if (file.data instanceof Uint8Array) {
        fileData = file.data;
        uploadedBytes += file.data.length;
        onProgress?.({
          uploadedBytes,
          totalBytes,
          percentage: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0,
          currentFile: filename,
          stage: "uploading",
        });
      } else {
        // ReadableStream - collect chunks
        const reader = file.data.getReader();
        const chunks: Uint8Array[] = [];

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            uploadedBytes += value.length;

            onProgress?.({
              uploadedBytes,
              totalBytes,
              percentage: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0,
              currentFile: filename,
              stage: "uploading",
            });
          }
        } finally {
          reader.releaseLock();
        }

        // Combine chunks
        const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        fileData = combined;
      }

      const blob = binaryToBlob(fileData, file.contentType ?? "application/octet-stream");
      formData.append(file.name, blob, filename);
    }

    onProgress?.({
      uploadedBytes,
      totalBytes,
      percentage: 100,
      currentFile: "all files",
      stage: "processing",
    });

    const response = await this.post<T>(endpoint, formData, requestOptions);

    onProgress?.({
      uploadedBytes,
      totalBytes,
      percentage: 100,
      currentFile: "all files",
      stage: "completed",
    });

    return response;
  }

  /**
   * Request file stream (for downloads)
   */
  async requestFileStream<T = unknown>(
    endpoint: string,
    options: ExtendedHttpOptions = {}
  ): Promise<{
    data?: T;
    fileStream?: ReadableStream<Uint8Array>;
    fileMetadata?: {
      filename: string;
      contentType: string;
      size?: number;
    };
    status: number;
    statusText: string;
    headers: Record<string, string>;
  }> {
    const response = await this.fetcher.raw(endpoint, {
      method: options.method ?? "GET",
      headers: {
        ...this.config.headers,
        ...options.headers,
      },
      timeout: options.timeout ?? this.config.timeout,
      signal: options.signal,
      responseType: "stream",
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const contentType = headers["content-type"] ?? "";
    const contentDisposition = headers["content-disposition"] ?? "";

    // Extract filename from content-disposition
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = filenameMatch?.[1]?.replace(/['"]/g, "") ?? "download";

    const contentLength = headers["content-length"];
    const fileMetadata = {
      filename,
      contentType,
      ...(contentLength && { size: Number.parseInt(contentLength) }),
    };

    // Check if response is a file stream
    if (
      contentType.includes("application/zip") ||
      contentType.includes("application/octet-stream")
    ) {
      return {
        fileStream: response.body ?? undefined,
        fileMetadata,
        status: response.status,
        statusText: response.statusText,
        headers,
      };
    }

    // Otherwise return data
    let data: T;
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const combined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const text = uint8ArrayToString(combined);
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = text as unknown as T;
      }
    } else {
      data = response._data as T;
    }

    return {
      data,
      status: response.status,
      statusText: response.statusText,
      headers,
    };
  }

  /**
   * Update client configuration
   */
  updateConfig(config: Partial<HttpClientConfig>): void {
    Object.assign(this.config, config);

    if (this.config.baseUrl.endsWith("/")) {
      this.config.baseUrl = this.config.baseUrl.slice(0, -1);
    }

    // Recreate fetcher with new config
    this.fetcher = ofetch.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: this.config.headers,
      retry: this.config.retry,
      retryDelay: this.config.retryDelay,
      retryStatusCodes: this.config.retryStatusCodes,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): HttpClientConfig {
    return { ...this.config };
  }

  /**
   * Normalize errors to a consistent format
   */
  private normalizeError(error: unknown): Error {
    if (error instanceof Error) {
      // Handle ofetch FetchError
      const fetchError = error as FetchError;
      if (fetchError.data || fetchError.statusCode) {
        const message = this.extractErrorMessage(fetchError.data) ?? fetchError.message;
        const normalizedError = new Error(message);
        (normalizedError as Error & { statusCode?: number }).statusCode = fetchError.statusCode;
        (normalizedError as Error & { data?: unknown }).data = fetchError.data;
        return normalizedError;
      }
      return error;
    }

    return new Error(String(error));
  }

  /**
   * Extract error message from various error formats
   */
  private extractErrorMessage(body: unknown): string | undefined {
    if (typeof body === "string") return body;

    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const detail = record.detail;

      if (Array.isArray(detail)) {
        const parts = detail.map((d) => {
          if (d && typeof d === "object") {
            const r = d as Record<string, unknown>;
            if (typeof r.msg === "string") return r.msg;
            if (typeof r.message === "string") return r.message;
            try {
              return JSON.stringify(d);
            } catch {
              return String(d);
            }
          }
          return String(d);
        });
        return parts.join("; ");
      }

      if (typeof detail === "string") return detail;
      if (typeof record.message === "string") return record.message;
      if (typeof record.error === "string") return record.error;
    }

    return undefined;
  }
}

/**
 * Create a new platform HTTP client
 */
export function createHttpClient(config: HttpClientConfig): PlatformHttpClient {
  return new PlatformHttpClient(config);
}

// Re-export ofetch for advanced usage
export { $fetch, ofetch, type FetchOptions, type FetchError };
