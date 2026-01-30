/**
 * HTTP client for Docling API
 * Wraps the cross-runtime platform HTTP client while maintaining backward compatibility
 */

import {
  PlatformHttpClient,
  type ExtendedHttpOptions,
  type FileUploadInfo,
} from "../platform";
import {
  createBinary,
  bufferToUint8Array,
  isNodeBuffer,
  type BinaryData,
} from "../platform/binary";
import { isNode } from "../platform/detection";
import { DoclingNetworkError, DoclingTimeoutError } from "../types";
import type { ApiClientConfig } from "../types/api";

/**
 * Extended HTTP request options based on native RequestInit
 */
export interface HttpRequestOptions extends Omit<RequestInit, "signal"> {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  accept?: "json" | "text" | "bytes";
}

/**
 * HTTP response interface
 */
export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

/**
 * HTTP client for Docling API with cross-runtime support
 * Maintains backward compatibility with the existing API while using ofetch internally
 */
export class HttpClient {
  private platformClient: PlatformHttpClient;
  private config: Required<ApiClientConfig>;

  constructor(config: ApiClientConfig) {
    if (!config.baseUrl) {
      throw new Error("baseUrl is required in ApiClientConfig");
    }

    this.config = {
      baseUrl: config.baseUrl.endsWith("/") ? config.baseUrl.slice(0, -1) : config.baseUrl,
      timeout: config.timeout || 60000,
      headers: config.headers || {},
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 1000,
    };

    this.platformClient = new PlatformHttpClient({
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: this.config.headers,
      retry: this.config.retries,
      retryDelay: this.config.retryDelay,
    });
  }

  /**
   * Make HTTP request
   */
  async request<T>(endpoint: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    try {
      const platformOptions: ExtendedHttpOptions = {
        method: (options.method as ExtendedHttpOptions["method"]) || "GET",
        headers: this.buildHeaders(options.headers),
        timeout: options.timeout || this.config.timeout,
        retry: options.retries ?? this.config.retries,
        retryDelay: options.retryDelay ?? this.config.retryDelay,
      };

      // Handle body
      if (options.body !== undefined) {
        platformOptions.body = this.normalizeBody(options.body);
      }

      // Handle accept header
      if (options.accept === "json") {
        platformOptions.responseType = "json";
      } else if (options.accept === "text") {
        platformOptions.responseType = "text";
      } else if (options.accept === "bytes") {
        platformOptions.responseType = "binary";
      }

      const response = await this.platformClient.request<T>(endpoint, platformOptions);

      // Convert Uint8Array back to Buffer for backward compatibility in Node.js
      let data = response.data;
      if (options.accept === "bytes" && data instanceof Uint8Array && isNode()) {
        data = this.toBuffer(data) as unknown as T;
      }

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };
    } catch (error) {
      throw this.normalizeError(error, options.timeout || this.config.timeout, endpoint);
    }
  }

  /**
   * GET request
   */
  async get<T = unknown>(
    endpoint: string,
    options: Omit<HttpRequestOptions, "method"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  }

  /**
   * POST request
   */
  async post<T = unknown>(
    endpoint: string,
    body?: BodyInit | null,
    options: Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      ...(body !== undefined && { body }),
    });
  }

  /**
   * PUT request
   */
  async put<T = unknown>(
    endpoint: string,
    body?: BodyInit | null,
    options: Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      ...(body !== undefined && { body }),
    });
  }

  /**
   * DELETE request
   */
  async delete<T = unknown>(
    endpoint: string,
    options: Omit<HttpRequestOptions, "method"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  }

  /**
   * GET request expecting JSON response
   */
  async getJson<T>(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept" | "method"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: "GET", accept: "json" });
  }

  /**
   * POST request expecting JSON response
   */
  async postJson<T>(
    endpoint: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, "accept" | "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    const normalizedBody = body !== undefined ? JSON.stringify(body) : undefined;
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: normalizedBody,
      accept: "json",
    });
  }

  /**
   * PUT request expecting JSON response
   */
  async putJson<T>(
    endpoint: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, "accept" | "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    const normalizedBody = body !== undefined ? JSON.stringify(body) : undefined;
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: normalizedBody,
      accept: "json",
    });
  }

  /**
   * DELETE request expecting JSON response
   */
  async deleteJson<T>(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept" | "method"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: "DELETE", accept: "json" });
  }

  /**
   * Request expecting JSON response
   */
  async requestJson<T>(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, accept: "json" });
  }

  /**
   * Request expecting text response
   */
  async requestText(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept"> = {}
  ): Promise<HttpResponse<string>> {
    return this.request<string>(endpoint, { ...options, accept: "text" });
  }

  /**
   * Request expecting binary response
   */
  async requestBytes(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept"> = {}
  ): Promise<HttpResponse<BinaryData>> {
    return this.request<BinaryData>(endpoint, { ...options, accept: "bytes" });
  }

  /**
   * Upload files using multipart form data
   */
  async uploadFiles<T = unknown>(
    endpoint: string,
    files: Array<{
      name: string;
      data: BinaryData | string;
      filename?: string;
      contentType?: string;
    }>,
    fields: Record<string, unknown> = {},
    options: Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    try {
      const fileInfos: FileUploadInfo[] = files.map((file) => ({
        name: file.name,
        data: typeof file.data === "string" ? file.data : this.toUint8Array(file.data),
        filename: file.filename,
        contentType: file.contentType,
      }));

      const response = await this.platformClient.uploadFiles<T>(
        endpoint,
        fileInfos,
        fields,
        {
          timeout: options.timeout || this.config.timeout,
          retry: options.retries ?? this.config.retries,
          retryDelay: options.retryDelay ?? this.config.retryDelay,
          responseType: options.accept === "bytes" ? "binary" : "json",
        }
      );

      // Convert Uint8Array back to Buffer for backward compatibility
      let data = response.data;
      if (options.accept === "bytes" && data instanceof Uint8Array && isNode()) {
        data = this.toBuffer(data) as unknown as T;
      }

      return {
        data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };
    } catch (error) {
      throw this.normalizeError(error, options.timeout || this.config.timeout, endpoint);
    }
  }

  /**
   * Stream file upload with progress tracking
   */
  async streamUpload<T = unknown>(
    endpoint: string,
    files: Array<{
      name: string;
      data: BinaryData | ReadableStream;
      filename?: string;
      contentType?: string;
      size?: number;
    }>,
    fields: Record<string, unknown> = {},
    options: {
      onProgress?: (progress: {
        uploadedBytes: number;
        totalBytes: number;
        percentage: number;
        currentFile: string;
        stage: "preparing" | "uploading" | "processing" | "completed";
      }) => void;
      chunkSize?: number;
    } & Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    try {
      const { onProgress, chunkSize, ...requestOptions } = options;

      const normalizedFiles = files.map((file) => ({
        name: file.name,
        data:
          file.data instanceof ReadableStream
            ? file.data
            : this.toUint8Array(file.data),
        filename: file.filename,
        contentType: file.contentType,
        size: file.size,
      }));

      const response = await this.platformClient.streamUpload<T>(
        endpoint,
        normalizedFiles,
        fields,
        {
          onProgress,
          chunkSize,
          timeout: requestOptions.timeout || this.config.timeout,
          retry: requestOptions.retries ?? this.config.retries,
          retryDelay: requestOptions.retryDelay ?? this.config.retryDelay,
        }
      );

      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };
    } catch (error) {
      throw this.normalizeError(error, options.timeout || this.config.timeout, endpoint);
    }
  }

  /**
   * Chunked streaming upload for very large files
   */
  async chunkedStreamUpload<T = unknown>(
    endpoint: string,
    file: {
      name: string;
      stream: ReadableStream<Uint8Array>;
      filename: string;
      contentType?: string;
      size: number;
    },
    fields: Record<string, unknown> = {},
    options: {
      onProgress?: (progress: {
        uploadedBytes: number;
        totalBytes: number;
        percentage: number;
        chunkIndex: number;
        totalChunks: number;
        stage: "preparing" | "uploading" | "processing" | "completed";
      }) => void;
      chunkSize?: number;
    } & Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    // Use streamUpload internally
    const { onProgress, chunkSize = 1024 * 1024, ...requestOptions } = options;

    const totalChunks = Math.ceil(file.size / chunkSize);
    let chunkIndex = 0;

    return this.streamUpload<T>(
      endpoint,
      [
        {
          name: file.name,
          data: file.stream,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
        },
      ],
      fields,
      {
        ...requestOptions,
        chunkSize,
        onProgress: (progress) => {
          if (onProgress) {
            chunkIndex = Math.ceil((progress.uploadedBytes / file.size) * totalChunks);
            onProgress({
              uploadedBytes: progress.uploadedBytes,
              totalBytes: progress.totalBytes,
              percentage: progress.percentage,
              chunkIndex,
              totalChunks,
              stage: progress.stage,
            });
          }
        },
      }
    );
  }

  /**
   * Pipeline upload for Node.js ReadableStream
   * Note: For cross-runtime compatibility, use streamUpload with ReadableStream<Uint8Array> instead
   */
  async pipelineUpload<T = unknown>(
    endpoint: string,
    file: {
      name: string;
      stream: NodeJS.ReadableStream;
      filename: string;
      contentType?: string;
      size?: number;
    },
    fields: Record<string, unknown> = {},
    options: {
      onProgress?: (progress: {
        uploadedBytes: number;
        totalBytes: number;
        percentage: number;
        bytesPerSecond: number;
        stage: "preparing" | "uploading" | "processing" | "completed";
      }) => void;
    } & Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    // Convert Node.js stream to Web ReadableStream
    const webStream = this.nodeStreamToWebStream(file.stream);

    return this.streamUpload<T>(
      endpoint,
      [
        {
          name: file.name,
          data: webStream,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
        },
      ],
      fields,
      {
        ...options,
        onProgress: options.onProgress
          ? (progress) => {
              options.onProgress?.({
                uploadedBytes: progress.uploadedBytes,
                totalBytes: progress.totalBytes,
                percentage: progress.percentage,
                bytesPerSecond: 0, // Not available with platform client
                stage: progress.stage,
              });
            }
          : undefined,
      }
    );
  }

  /**
   * Stream passthrough upload
   */
  async streamPassthrough<T = unknown>(
    endpoint: string,
    inputStream: NodeJS.ReadableStream,
    filename: string,
    contentType: string,
    fields: Record<string, unknown> = {},
    options: {
      onProgress?: (progress: {
        uploadedBytes: number;
        totalBytes: number;
        percentage: number;
        bytesPerSecond: number;
        stage: "preparing" | "uploading" | "processing" | "completed";
      }) => void;
      estimatedSize?: number;
      accept?: "json" | "zip";
    } & Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    const { onProgress, estimatedSize, accept, ...requestOptions } = options;

    const webStream = this.nodeStreamToWebStream(inputStream);

    return this.streamUpload<T>(
      endpoint,
      [
        {
          name: "files",
          data: webStream,
          filename,
          contentType,
          size: estimatedSize,
        },
      ],
      fields,
      {
        ...requestOptions,
        onProgress: onProgress
          ? (progress) => {
              onProgress({
                uploadedBytes: progress.uploadedBytes,
                totalBytes: progress.totalBytes,
                percentage: progress.percentage,
                bytesPerSecond: 0,
                stage: progress.stage,
              });
            }
          : undefined,
      }
    );
  }

  /**
   * Upload file from filesystem (Node.js only)
   */
  async uploadFileStream<T = unknown>(
    endpoint: string,
    filePath: string,
    fieldName = "files",
    fields: Record<string, unknown> = {},
    options: {
      onProgress?: (progress: {
        uploadedBytes: number;
        totalBytes: number;
        percentage: number;
        bytesPerSecond: number;
        stage: "preparing" | "uploading" | "processing" | "completed";
      }) => void;
    } & Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    if (!isNode()) {
      throw new Error("uploadFileStream is only available in Node.js. Use uploadFiles with Uint8Array instead.");
    }

    // Dynamic import for Node.js fs
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");

    const stats = await stat(filePath);
    const fileStream = createReadStream(filePath);
    const filename = filePath.split("/").pop() || "file";
    const contentType = this.getContentTypeFromFilename(filename);

    return this.pipelineUpload<T>(
      endpoint,
      {
        name: fieldName,
        stream: fileStream,
        filename,
        contentType,
        size: stats.size,
      },
      fields,
      options
    );
  }

  /**
   * Request file stream (for ZIP downloads)
   */
  async requestFileStream<T = unknown>(
    endpoint: string,
    options: HttpRequestOptions = {}
  ): Promise<{
    data?: T;
    fileStream?: import("node:stream").Readable;
    fileMetadata?: {
      filename: string;
      contentType: string;
      size?: number;
    };
    status: number;
    statusText: string;
    headers: Record<string, string>;
  }> {
    try {
      const response = await this.platformClient.requestFileStream<T>(endpoint, {
        method: (options.method as ExtendedHttpOptions["method"]) || "GET",
        headers: this.buildHeaders(options.headers),
        timeout: options.timeout || this.config.timeout,
      });

      // Convert Web ReadableStream to Node.js Readable (if in Node.js)
      let fileStream: import("node:stream").Readable | undefined;
      if (response.fileStream && isNode()) {
        const { Readable } = await import("node:stream");
        // Cast to unknown first to avoid type incompatibility between Web and Node.js ReadableStream
        fileStream = Readable.fromWeb(response.fileStream as unknown as import("stream/web").ReadableStream);
      }

      return {
        data: response.data,
        fileStream,
        fileMetadata: response.fileMetadata,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      };
    } catch (error) {
      throw this.normalizeError(error, options.timeout || this.config.timeout, endpoint);
    }
  }

  /**
   * Update client configuration
   */
  updateConfig(config: Partial<ApiClientConfig>): void {
    Object.assign(this.config, config);

    if (this.config.baseUrl.endsWith("/")) {
      this.config.baseUrl = this.config.baseUrl.slice(0, -1);
    }

    this.platformClient.updateConfig({
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: this.config.headers,
      retry: this.config.retries,
      retryDelay: this.config.retryDelay,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): ApiClientConfig {
    return { ...this.config };
  }

  /**
   * Get connection pool statistics (no-op for cross-runtime)
   */
  getPoolStats() {
    return {
      total: 0,
      pending: 0,
      free: 0,
      active: 0,
    };
  }

  /**
   * Get connection pool health (no-op for cross-runtime)
   */
  getPoolHealth() {
    return { healthy: true };
  }

  /**
   * Update connection pool configuration (no-op for cross-runtime)
   */
  updatePoolConfig(_config: unknown) {
    // No-op - ofetch handles connection pooling internally
  }

  /**
   * Close idle connections (no-op for cross-runtime)
   */
  closeIdleConnections() {
    // No-op - ofetch handles connection pooling internally
  }

  /**
   * Destroy connection pool (no-op for cross-runtime)
   */
  destroy() {
    // No-op - ofetch handles cleanup internally
  }

  // Private helper methods

  /**
   * Build request headers
   */
  private buildHeaders(additionalHeaders?: HeadersInit): Record<string, string> {
    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (!additionalHeaders) {
      return baseHeaders;
    }

    if (additionalHeaders instanceof Headers) {
      const result = { ...baseHeaders };
      additionalHeaders.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    }

    if (Array.isArray(additionalHeaders)) {
      const result = { ...baseHeaders };
      for (const [key, value] of additionalHeaders) {
        result[key] = value;
      }
      return result;
    }

    return { ...baseHeaders, ...(additionalHeaders as Record<string, string>) };
  }

  /**
   * Normalize body for platform client
   */
  private normalizeBody(body: BodyInit | unknown): string | Uint8Array | FormData | ReadableStream<Uint8Array> {
    if (body instanceof FormData) {
      return body;
    }

    if (body instanceof ReadableStream) {
      return body as ReadableStream<Uint8Array>;
    }

    if (typeof body === "string") {
      return body;
    }

    if (body instanceof ArrayBuffer) {
      return new Uint8Array(body);
    }

    if (body instanceof Uint8Array) {
      return body;
    }

    if (isNodeBuffer(body)) {
      return bufferToUint8Array(body);
    }

    // Object - serialize to JSON
    return JSON.stringify(body);
  }

  /**
   * Convert to Uint8Array
   */
  private toUint8Array(data: unknown): Uint8Array {
    if (data instanceof Uint8Array) {
      return data;
    }
    if (isNodeBuffer(data)) {
      return bufferToUint8Array(data);
    }
    if (typeof data === "string") {
      return createBinary(data);
    }
    throw new Error("Cannot convert to Uint8Array");
  }

  /**
   * Convert Uint8Array to Buffer (Node.js only)
   */
  private toBuffer(data: Uint8Array): unknown {
    if (isNode()) {
      // In Node.js, Buffer is a subclass of Uint8Array
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    return data;
  }

  /**
   * Convert Node.js ReadableStream to Web ReadableStream
   */
  private nodeStreamToWebStream(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        nodeStream.on("data", (chunk: unknown) => {
          if (typeof chunk === "string") {
            controller.enqueue(new TextEncoder().encode(chunk));
          } else if (chunk instanceof Uint8Array) {
            controller.enqueue(chunk);
          } else if (isNodeBuffer(chunk)) {
            controller.enqueue(new Uint8Array(chunk as Buffer));
          }
        });

        nodeStream.on("end", () => {
          controller.close();
        });

        nodeStream.on("error", (err) => {
          controller.error(err);
        });
      },
    });
  }

  /**
   * Get content type from filename
   */
  private getContentTypeFromFilename(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop();
    const contentTypes: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      txt: "text/plain",
      md: "text/markdown",
      html: "text/html",
      json: "application/json",
      xml: "application/xml",
      csv: "text/csv",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
    };

    return contentTypes[ext || ""] || "application/octet-stream";
  }

  /**
   * Normalize errors to consistent format
   */
  private normalizeError(error: unknown, timeout: number, context: string): Error {
    if (error instanceof DoclingNetworkError || error instanceof DoclingTimeoutError) {
      return error;
    }

    if (error instanceof Error) {
      // Check for timeout
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        return new DoclingTimeoutError(timeout, context);
      }

      // Check for network error with status code
      const errWithStatus = error as Error & { statusCode?: number; data?: unknown };
      if (errWithStatus.statusCode !== undefined) {
        return new DoclingNetworkError(
          error.message,
          errWithStatus.statusCode,
          errWithStatus.data
        );
      }

      return error;
    }

    return new Error(String(error));
  }
}
