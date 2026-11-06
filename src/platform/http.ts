/**
 * Cross-runtime HTTP client based on ofetch
 * Provides a unified HTTP interface for all runtime environments
 */

import { type $fetch, type FetchError, type FetchOptions, ofetch } from "ofetch";
import { type BinaryData, binaryToBlob } from "./binary";
import type {
  ExtendedHttpOptions,
  FetchContext,
  FileUploadInfo,
  HttpClientConfig,
  HttpResponse,
  UploadProgress,
} from "./types";

/**
 * Default retry status codes
 */
const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

// Error bodies are optional diagnostics, including after ofetch has cleared its header timeout.
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_ERROR_BODY_TIME_MS = 1000;

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
    const requestHeaders = new Headers(this.config.headers);
    new Headers(options.headers).forEach((value, key) => requestHeaders.set(key, value));

    // biome-ignore lint/suspicious/noExplicitAny: ofetch interceptors have complex generic types
    const fetchOptions: FetchOptions<any> = {
      method: options.method ?? "GET",
      headers: requestHeaders,
      timeout: options.timeout ?? this.config.timeout,
      retry: options.retry ?? this.config.retry,
      retryDelay: options.retryDelay ?? this.config.retryDelay,
      retryStatusCodes: options.retryStatusCodes ?? this.config.retryStatusCodes,
      signal: options.signal,
      query: options.query,
      parseResponse:
        options.responseType === "binary" ||
        options.responseType === "stream" ||
        options.responseType === "text"
          ? undefined
          : options.parseResponse !== false
            ? JSON.parse
            : undefined,
      ignoreResponseError: options.ignoreResponseError,
      // Cast interceptors to any to bypass ofetch's complex generic types
      onRequest: options.onRequest as FetchOptions["onRequest"],
      onResponse: options.onResponse as FetchOptions["onResponse"],
      onRequestError: options.onRequestError as FetchOptions["onRequestError"],
      onResponseError: async (context) => {
        // Consume/cancel each failed attempt, including responses that ofetch will retry.
        if (context.response._data instanceof ReadableStream) {
          context.response._data = await this.readErrorDiagnostics(
            context.response._data,
            options.timeout ?? this.config.timeout
          );
        }
        await options.onResponseError?.(context as unknown as FetchContext);
      },
    };

    // Handle body
    if (options.body !== undefined) {
      if (options.body instanceof FormData) {
        fetchOptions.body = options.body;
        // Remove Content-Type so the runtime auto-generates the multipart boundary
        requestHeaders.delete("Content-Type");
      } else if (options.body instanceof ReadableStream) {
        fetchOptions.body = options.body;
      } else if (typeof options.body === "string") {
        fetchOptions.body = options.body;
      } else if (options.body instanceof Uint8Array) {
        fetchOptions.body = options.body;
      } else {
        // Object - serialize to JSON
        fetchOptions.body = JSON.stringify(options.body);
        requestHeaders.set("Content-Type", "application/json");
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
      const response = await this.fetcher.raw<T>(endpoint, fetchOptions as FetchOptions<any>);

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
      throw await this.normalizeError(error, options.timeout ?? this.config.timeout);
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
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: body as ExtendedHttpOptions["body"],
    });
  }

  /**
   * PUT request
   */
  async put<T = unknown>(
    endpoint: string,
    body?: unknown,
    options: Omit<ExtendedHttpOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body as ExtendedHttpOptions["body"],
    });
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
        formData.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
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
        formData.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
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
    const response = await this.request<ReadableStream<Uint8Array>>(endpoint, {
      ...options,
      responseType: "stream",
    });
    const { headers } = response;

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
        fileStream: response.data ?? undefined,
        fileMetadata,
        status: response.status,
        statusText: response.statusText,
        headers,
      };
    }

    const text = response.data ? await new Response(response.data).text() : "";
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as T;
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
  private async normalizeError(error: unknown, timeout: number): Promise<Error> {
    if (error instanceof Error) {
      // Handle ofetch FetchError
      const fetchError = error as FetchError;
      if (fetchError.data || fetchError.statusCode) {
        let data: unknown = fetchError.data;
        if (data instanceof ReadableStream) data = await this.readErrorDiagnostics(data, timeout);
        if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data);
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {
            /* Preserve plain-text diagnostics. */
          }
        }
        const message = this.extractErrorMessage(data) ?? fetchError.message;
        const normalizedError = new Error(message);
        (normalizedError as Error & { statusCode?: number }).statusCode = fetchError.statusCode;
        (normalizedError as Error & { data?: unknown }).data = data;
        return normalizedError;
      }
      return error;
    }

    return new Error(String(error));
  }

  private async readErrorDiagnostics(
    stream: ReadableStream<Uint8Array>,
    timeout: number
  ): Promise<string | undefined> {
    const budget = Math.min(
      MAX_ERROR_BODY_TIME_MS,
      Number.isFinite(timeout) && timeout > 0 ? timeout : MAX_ERROR_BODY_TIME_MS
    );
    const deadline = Date.now() + budget;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    let complete = false;
    try {
      reader = stream.getReader();
      const bodyReader = reader;
      const consume = async () => {
        const bytes = new Uint8Array(MAX_ERROR_BODY_BYTES);
        let size = 0;
        while (Date.now() < deadline) {
          const { done, value } = await bodyReader.read();
          if (done) {
            complete = true;
            return new TextDecoder().decode(bytes.subarray(0, size));
          }
          if (value.byteLength > MAX_ERROR_BODY_BYTES - size) return undefined;
          bytes.set(value, size);
          size += value.byteLength;
        }
        return undefined;
      };
      return await Promise.race([
        consume(),
        new Promise<undefined>((resolve) => {
          timer = globalThis.setTimeout(() => resolve(undefined), budget);
        }),
      ]);
    } catch {
      // A failed diagnostic read must preserve the HTTP status and original error message.
      return undefined;
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      if (reader) {
        // Cancellation itself can stall or reject; it must never delay the HTTP error.
        if (!complete)
          void reader.cancel().catch(() => {
            // Diagnostic cancellation cannot replace the original HTTP error.
          });
        reader.releaseLock();
      }
    }
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
