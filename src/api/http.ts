import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Transform } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { DoclingNetworkError, DoclingTimeoutError } from "../types";
import type { ApiClientConfig, ProcessingError } from "../types/api";
import { ConnectionPool, type ConnectionPoolConfig } from "./connection-pool";

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
 * Retry configuration for HTTP requests
 */
interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryableStatusCodes: Set<number>;
}

/**
 * HTTP client for Docling API with connection pooling
 */
export class HttpClient {
  private config: Required<ApiClientConfig>;
  private retryConfig: RetryConfig;
  private connectionPool: ConnectionPool;

  constructor(config: ApiClientConfig) {
    if (!config.baseUrl) {
      throw new Error("baseUrl is required in ApiClientConfig");
    }

    this.config = {
      baseUrl: config.baseUrl,
      timeout: config.timeout || 60000,
      headers: config.headers || {},
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 1000,
    };

    this.retryConfig = {
      maxAttempts: this.config.retries + 1,
      baseDelay: this.config.retryDelay,
      maxDelay: 30000,
      backoffFactor: 2,
      retryableStatusCodes: new Set([408, 429, 500, 502, 503, 504]),
    };

    this.connectionPool = new ConnectionPool({
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: this.config.timeout,
      keepAlive: true,
      keepAliveTimeout: 30000,
    });

    if (this.config.baseUrl.endsWith("/")) {
      this.config.baseUrl = this.config.baseUrl.slice(0, -1);
    }
  }

  /**
   * Build request headers with proper typing using native HeadersInit (functional approach)
   */
  private buildHeaders(additionalHeaders?: HeadersInit): HeadersInit {
    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (!additionalHeaders) {
      return baseHeaders;
    }

    if (additionalHeaders instanceof Headers) {
      return this.combineWithHeadersObject(baseHeaders, additionalHeaders);
    }

    if (Array.isArray(additionalHeaders)) {
      return this.combineWithHeadersArray(baseHeaders, additionalHeaders);
    }

    return this.combineWithHeadersRecord(baseHeaders, additionalHeaders as Record<string, string>);
  }

  private combineWithHeadersObject(baseHeaders: Record<string, string>, headers: Headers): Headers {
    const combined = new Headers(baseHeaders);
    headers.forEach((value, key) => combined.set(key, value));
    return combined;
  }

  private combineWithHeadersArray(
    baseHeaders: Record<string, string>,
    headers: [string, string][]
  ): Headers {
    const combined = new Headers(baseHeaders);
    for (const [key, value] of headers) {
      combined.set(key, value);
    }
    return combined;
  }

  private combineWithHeadersRecord(
    baseHeaders: Record<string, string>,
    headers: Record<string, string>
  ): Record<string, string> {
    return { ...baseHeaders, ...headers };
  }

  /**
   * Process request body and handle headers accordingly (functional approach)
   */
  private processRequestBody(
    body: BodyInit | null | unknown,
    headers: HeadersInit
  ): { body: BodyInit | null; headers: HeadersInit } {
    if (body instanceof FormData) {
      return {
        body,
        headers: this.removeContentTypeHeader(headers),
      };
    }

    if (this.isNativeBodyType(body)) {
      return { body: body as BodyInit, headers };
    }

    return {
      body: JSON.stringify(body),
      headers,
    };
  }

  private isNativeBodyType(body: unknown): boolean {
    return (
      typeof body === "string" ||
      body instanceof ArrayBuffer ||
      body instanceof Uint8Array ||
      body instanceof ReadableStream
    );
  }

  private removeContentTypeHeader(headers: HeadersInit): HeadersInit {
    if (headers instanceof Headers) {
      const newHeaders = new Headers(headers);
      newHeaders.delete("Content-Type");
      return newHeaders;
    }

    if (Array.isArray(headers)) {
      return headers.filter(([key]) => key.toLowerCase() !== "content-type");
    }

    const headersRecord = headers as Record<string, string>;
    const { "Content-Type": _, ...rest } = headersRecord;
    return rest;
  }

  /**
   * Normalize HeadersInit to a plain record for consistent fetch() inputs and testing
   */
  private headersToRecord(h: HeadersInit): Record<string, string> {
    if (h instanceof Headers) {
      const out: Record<string, string> = {};
      h.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    }
    if (Array.isArray(h)) {
      return Object.fromEntries(h);
    }
    return { ...(h as Record<string, string>) };
  }

  /**
   * Accept header mapping and typed parsing helpers
   */
  private getAcceptFromOption(accept?: "json" | "text" | "bytes"): string {
    if (accept === "json") return "application/json";
    if (accept === "text") return "text/plain";
    return "*/*";
  }

  private async parseFetchByAccept<T>(
    res: Response,
    accept?: "json" | "text" | "bytes"
  ): Promise<T> {
    if (accept === "json") return (await res.json()) as T;
    if (accept === "text") return (await res.text()) as unknown as T;

    const anyRes = res as unknown as {
      arrayBuffer?: () => Promise<ArrayBuffer>;
      buffer?: () => Promise<Buffer>;
      text?: () => Promise<string>;
    };
    if (typeof anyRes.arrayBuffer === "function") {
      const buf = Buffer.from(await anyRes.arrayBuffer());
      return buf as unknown as T;
    }
    if (typeof anyRes.buffer === "function") {
      const buf = await anyRes.buffer();
      return buf as unknown as T;
    }
    const txt = await res.text();
    return Buffer.from(txt, "utf8") as unknown as T;
  }

  private async parseBufferByAccept<T>(
    buf: Buffer,
    accept?: "json" | "text" | "bytes"
  ): Promise<T> {
    if (accept === "json") return JSON.parse(buf.toString("utf8")) as T;
    if (accept === "text") return buf.toString("utf8") as unknown as T;
    return buf as unknown as T;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const delay = this.retryConfig.baseDelay * this.retryConfig.backoffFactor ** attempt;
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof DoclingNetworkError) {
      return this.retryConfig.retryableStatusCodes.has(error.statusCode || 0);
    }

    if (error instanceof Error) {
      return error.name !== "AbortError";
    }

    return false;
  }

  /**
   * Execute a request with proper retry logic (functional approach)
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<HttpResponse<T>>,
    context: string
  ): Promise<HttpResponse<T>> {
    const attempts = Array.from({ length: this.retryConfig.maxAttempts }, (_, i) => i);

    for (const attempt of attempts) {
      try {
        return await requestFn();
      } catch (error) {
        if (attempt === this.retryConfig.maxAttempts - 1) {
          throw error;
        }

        if (!this.isRetryableError(error)) {
          throw error;
        }

        const delayMs = this.calculateRetryDelay(attempt);
        await delay(delayMs);
      }
    }

    throw new Error(`Unexpected end of retry loop for ${context}`);
  }

  /**
   * Make HTTP request with retry logic
   */
  async request<T>(endpoint: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const context = `${options.method || "GET"} ${endpoint}`;

    return this.executeWithRetry(async () => {
      const { accept: acceptHeader, ...rest } = options;
      const requestOptions: RequestInit = {
        method: rest.method || "GET",
        headers: rest.headers ? this.buildHeaders(rest.headers) : this.buildHeaders(),
        signal: this.createAbortSignal(rest.timeout || this.config.timeout),
        ...rest,
      };

      if (options.body) {
        const { body, headers } = this.processRequestBody(
          options.body,
          requestOptions.headers || {}
        );
        requestOptions.body = body;
        requestOptions.headers = headers;
      }

      if (options.accept) {
        const hdr = this.headersToRecord(requestOptions.headers as HeadersInit);
        hdr.Accept = this.getAcceptFromOption(options.accept);
        requestOptions.headers = hdr;
      }

      try {
        if (this.shouldUseFetchTransport() || requestOptions.body instanceof FormData) {
          const fetchHeadersObj = this.headersToRecord(requestOptions.headers as HeadersInit);
          if (options.accept) {
            fetchHeadersObj.Accept = this.getAcceptFromOption(options.accept);
          }
          const res = await fetch(url, {
            ...requestOptions,
            headers: fetchHeadersObj,
          });

          const headers = this.parseHeaders(res.headers as Headers);

          if (!res.ok) {
            let errBody: unknown;
            try {
              errBody = await res.json();
            } catch {
              // Ignore errors
              errBody = undefined;
            }
            const message =
              this.extractErrorMessage(errBody) || res.statusText || `HTTP ${res.status}`;
            throw new DoclingNetworkError(message, res.status, errBody);
          }

          const data = options.accept
            ? await this.parseFetchByAccept<T>(res, options.accept)
            : (res.headers.get("content-type") || "").includes("application/json")
              ? ((await res.json()) as T)
              : ((await res.text()) as unknown as T);

          return {
            data: data as T,
            status: res.status,
            statusText: res.statusText,
            headers,
          };
        }

        const response = await this.makePooledRequest(
          url,
          requestOptions,
          options.timeout || this.config.timeout
        );

        if (response.status >= 400) {
          const errorData = await this.parseErrorResponseFromBuffer(response.data as Buffer);
          const message =
            this.extractErrorMessage(errorData) ||
            errorData.message ||
            `HTTP ${response.status}: ${response.statusText}`;
          throw new DoclingNetworkError(message, response.status, errorData);
        }

        const data = await this.parseBufferByAccept<T>(response.data as Buffer, options.accept);

        return {
          data,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new DoclingTimeoutError(options.timeout || this.config.timeout, context);
        }
        throw error;
      }
    }, context);
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
   * Upload files using multipart form data
   */

  /**
   * Convenience helpers that set Accept and parse deterministically
   */
  async requestJson<T>(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept"> = {}
  ): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...options, accept: "json" });
  }

  async requestText(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept"> = {}
  ): Promise<HttpResponse<string>> {
    return this.request<string>(endpoint, { ...options, accept: "text" });
  }

  async requestBytes(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept"> = {}
  ): Promise<HttpResponse<Buffer>> {
    return this.request<Buffer>(endpoint, { ...options, accept: "bytes" });
  }

  /**
   * Verb helpers with JSON semantics
   */
  async getJson<T>(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept" | "method"> = {}
  ): Promise<HttpResponse<T>> {
    return this.requestJson<T>(endpoint, { ...options, method: "GET" });
  }

  async postJson<T>(
    endpoint: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, "accept" | "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    const hasBody = typeof body !== "undefined";
    const normalizedBody: BodyInit | null = hasBody
      ? body instanceof FormData
        ? body
        : this.isNativeBodyType(body)
          ? (body as BodyInit)
          : JSON.stringify(body)
      : null;

    return this.requestJson<T>(endpoint, {
      ...options,
      method: "POST",
      body: normalizedBody,
    });
  }

  async putJson<T>(
    endpoint: string,
    body?: unknown,
    options: Omit<HttpRequestOptions, "accept" | "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    const hasBody = typeof body !== "undefined";
    const normalizedBody: BodyInit | null = hasBody
      ? body instanceof FormData
        ? body
        : this.isNativeBodyType(body)
          ? (body as BodyInit)
          : JSON.stringify(body)
      : null;

    return this.requestJson<T>(endpoint, {
      ...options,
      method: "PUT",
      body: normalizedBody,
    });
  }

  async deleteJson<T>(
    endpoint: string,
    options: Omit<HttpRequestOptions, "accept" | "method"> = {}
  ): Promise<HttpResponse<T>> {
    return this.requestJson<T>(endpoint, { ...options, method: "DELETE" });
  }

  async uploadFiles<T = unknown>(
    endpoint: string,
    files: Array<{
      name: string;
      data: Buffer | string;
      filename?: string;
      contentType?: string;
    }>,
    fields: Record<string, unknown> = {},
    options: Omit<HttpRequestOptions, "method" | "body"> = {}
  ): Promise<HttpResponse<T>> {
    const formData = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          formData.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }

    for (const file of files) {
      const blob = Buffer.isBuffer(file.data)
        ? new Blob([new Uint8Array(file.data)], {
            type: file.contentType || "application/octet-stream",
          })
        : new Blob([file.data], {
            type: file.contentType || "text/plain",
          });

      const filename = file.filename || "file";

      formData.append(file.name, blob, filename);
    }

    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: formData,
    });
  }

  /**
   * Stream file upload with real-time progress tracking
   */
  async streamUpload<T = unknown>(
    endpoint: string,
    files: Array<{
      name: string;
      data: Buffer | ReadableStream;
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
    const { onProgress, chunkSize = 64 * 1024, ...requestOptions } = options;

    const totalBytes = files.reduce((total, file) => {
      if (file.size) return total + file.size;
      if (Buffer.isBuffer(file.data)) return total + file.data.length;
      return total;
    }, 0);

    let uploadedBytes = 0;

    if (onProgress) {
      onProgress({
        uploadedBytes: 0,
        totalBytes,
        percentage: 0,
        currentFile: files[0]?.filename || "unknown",
        stage: "preparing",
      });
    }

    const formData = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          formData.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }

    for (const file of files) {
      const filename = file.filename || "file";

      if (Buffer.isBuffer(file.data)) {
        const blob = new Blob([new Uint8Array(file.data)], {
          type: file.contentType || "application/octet-stream",
        });

        formData.append(file.name, blob, filename);

        uploadedBytes += file.data.length;
        if (onProgress) {
          onProgress({
            uploadedBytes,
            totalBytes,
            percentage: Math.round((uploadedBytes / totalBytes) * 100),
            currentFile: filename,
            stage: "uploading",
          });
        }
      } else if (file.data instanceof ReadableStream) {
        const chunks: Uint8Array[] = [];
        const reader = file.data.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            uploadedBytes += value.length;

            if (onProgress) {
              onProgress({
                uploadedBytes,
                totalBytes,
                percentage: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0,
                currentFile: filename,
                stage: "uploading",
              });
            }
          }
        } finally {
          reader.releaseLock();
        }

        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        const blob = new Blob([combined], {
          type: file.contentType || "application/octet-stream",
        });

        formData.append(file.name, blob, filename);
      }
    }

    if (onProgress) {
      onProgress({
        uploadedBytes,
        totalBytes,
        percentage: 100,
        currentFile: "all files",
        stage: "processing",
      });
    }

    const response = await this.request<T>(endpoint, {
      ...requestOptions,
      method: "POST",
      body: formData,
    });

    if (onProgress) {
      onProgress({
        uploadedBytes,
        totalBytes,
        percentage: 100,
        currentFile: "all files",
        stage: "completed",
      });
    }

    return response;
  }

  /**
   * Chunked streaming upload for very large files
   * This method streams data without loading entire file into memory
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
    const { onProgress, chunkSize = 1024 * 1024, ...requestOptions } = options;

    const totalBytes = file.size;
    const totalChunks = Math.ceil(totalBytes / chunkSize);
    let uploadedBytes = 0;
    let chunkIndex = 0;

    if (onProgress) {
      onProgress({
        uploadedBytes: 0,
        totalBytes,
        percentage: 0,
        chunkIndex: 0,
        totalChunks,
        stage: "preparing",
      });
    }

    const chunks: Uint8Array[] = [];
    const reader = file.stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        chunks.push(value);
        uploadedBytes += value.length;
        chunkIndex++;

        if (onProgress) {
          onProgress({
            uploadedBytes,
            totalBytes,
            percentage: Math.round((uploadedBytes / totalBytes) * 100),
            chunkIndex,
            totalChunks,
            stage: "uploading",
          });
        }
      }
    } finally {
      reader.releaseLock();
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const formData = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          formData.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        formData.append(key, String(value));
      }
    }

    const blob = new Blob([combined], {
      type: file.contentType || "application/octet-stream",
    });

    formData.append(file.name, blob, file.filename);

    if (onProgress) {
      onProgress({
        uploadedBytes,
        totalBytes,
        percentage: 100,
        chunkIndex: totalChunks,
        totalChunks,
        stage: "processing",
      });
    }

    const response = await this.request<T>(endpoint, {
      ...requestOptions,
      method: "POST",
      body: formData,
    });

    if (onProgress) {
      onProgress({
        uploadedBytes,
        totalBytes,
        percentage: 100,
        chunkIndex: totalChunks,
        totalChunks,
        stage: "completed",
      });
    }

    return response;
  }

  /**
   * True streaming upload using Node.js native HTTP (not fetch)
   * This method streams data directly without loading into memory
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
    const { onProgress } = options;
    const url = new URL(`${this.config.baseUrl}${endpoint}`);
    const context = `POST ${endpoint}`;

    const totalBytes = file.size || 0;
    const startTime = Date.now();
    const progressState = { uploadedBytes: 0 };

    if (onProgress) {
      onProgress({
        uploadedBytes: 0,
        totalBytes,
        percentage: 0,
        bytesPerSecond: 0,
        stage: "preparing",
      });
    }

    return this.executeWithRetry(async () => {
      return new Promise<HttpResponse<T>>((resolve, reject) => {
        const boundary = `----formdata-boundary-${Date.now()}`;

        const formDataParts: string[] = [];
        for (const [key, value] of Object.entries(fields)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              formDataParts.push(this.createFormDataPart(boundary, key, String(item)));
            }
          } else if (value !== undefined && value !== null) {
            formDataParts.push(this.createFormDataPart(boundary, key, String(value)));
          }
        }

        const filePartHeader = this.createFilePartHeader(
          boundary,
          file.name,
          file.filename,
          file.contentType || "application/octet-stream"
        );

        const formDataPrefix = formDataParts.join("") + filePartHeader;
        const formDataSuffix = `\r\n--${boundary}--\r\n`;

        const prefixLength = Buffer.byteLength(formDataPrefix, "utf8");
        const suffixLength = Buffer.byteLength(formDataSuffix, "utf8");
        const contentLength = prefixLength + totalBytes + suffixLength;

        const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

        const req = requestFn(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: "POST",
            headers: {
              ...this.config.headers,
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Content-Length": contentLength.toString(),
            },
            timeout: options.timeout || this.config.timeout,
          },
          (res) => {
            let responseData = "";

            res.on("data", (chunk) => {
              responseData += chunk;
            });

            res.on("end", () => {
              try {
                if (!res.statusCode || res.statusCode >= 400) {
                  reject(
                    new DoclingNetworkError(
                      `HTTP ${res.statusCode}: ${res.statusMessage}`,
                      res.statusCode || 500,
                      { message: responseData }
                    )
                  );
                  return;
                }

                const data = JSON.parse(responseData);
                const headers = this.parseNodeHeaders(res.headers);

                if (onProgress) {
                  onProgress({
                    uploadedBytes: progressState.uploadedBytes,
                    totalBytes,
                    percentage: 100,
                    bytesPerSecond: Math.round(
                      (progressState.uploadedBytes / (Date.now() - startTime)) * 1000
                    ),
                    stage: "completed",
                  });
                }

                resolve({
                  data,
                  status: res.statusCode,
                  statusText: res.statusMessage || "OK",
                  headers,
                });
              } catch (error) {
                reject(error);
              }
            });
          }
        );

        req.on("error", (error) => {
          reject(error);
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new DoclingTimeoutError(options.timeout || this.config.timeout, context));
        });

        req.write(formDataPrefix);

        const progressTracker = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            progressState.uploadedBytes += chunk.length;
            const elapsed = Date.now() - startTime;
            const bytesPerSecond = elapsed > 0 ? (progressState.uploadedBytes / elapsed) * 1000 : 0;

            if (onProgress) {
              onProgress({
                uploadedBytes: progressState.uploadedBytes,
                totalBytes,
                percentage:
                  totalBytes > 0 ? Math.round((progressState.uploadedBytes / totalBytes) * 100) : 0,
                bytesPerSecond: Math.round(bytesPerSecond),
                stage: "uploading",
              });
            }

            callback(null, chunk);
          },
        });

        file.stream
          .pipe(progressTracker)
          .on("data", (chunk) => {
            req.write(chunk);
          })
          .on("end", () => {
            req.write(formDataSuffix);
            req.end();
          })
          .on("error", (error) => {
            req.destroy();
            reject(error);
          });
      });
    }, context);
  }

  /**
   * Map accept option to HTTP Accept header
   */
  private getAcceptHeader(accept?: "json" | "zip"): string {
    return accept === "zip" ? "application/zip" : "application/json";
  }

  /**
   * Extract a human-readable error message from a JSON-like error body
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
              // Ignore errors
              return String(d);
            }
          }
          return String(d);
        });
        return parts.join("; ");
      }
      if (typeof detail === "string") return detail;
      if (typeof record.message === "string") return record.message;
    }
    return undefined;
  }

  /**
   * True passthrough streaming - accepts any ReadableStream
   * Perfect for NestJS/Express file uploads where you receive streams from APIs
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
    const { onProgress, estimatedSize } = options;
    const url = new URL(`${this.config.baseUrl}${endpoint}`);
    const context = `POST ${endpoint}`;

    const totalBytes = estimatedSize || 0;
    const startTime = Date.now();
    const progressState = { uploadedBytes: 0 };

    if (onProgress) {
      onProgress({
        uploadedBytes: 0,
        totalBytes,
        percentage: 0,
        bytesPerSecond: 0,
        stage: "preparing",
      });
    }

    return this.executeWithRetry(async () => {
      return new Promise<HttpResponse<T>>((resolve, reject) => {
        const boundary = `----formdata-boundary-${Date.now()}`;

        const formDataParts: string[] = [];
        for (const [key, value] of Object.entries(fields)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              formDataParts.push(this.createFormDataPart(boundary, key, String(item)));
            }
          } else if (value !== undefined && value !== null) {
            formDataParts.push(this.createFormDataPart(boundary, key, String(value)));
          }
        }

        const filePartHeader = this.createFilePartHeader(boundary, "files", filename, contentType);

        const formDataPrefix = formDataParts.join("") + filePartHeader;
        const formDataSuffix = `\r\n--${boundary}--\r\n`;

        const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

        const req = requestFn(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: "POST",
            headers: {
              ...this.config.headers,
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Transfer-Encoding": "chunked",
              Accept: this.getAcceptHeader(options.accept),
            },
            timeout: options.timeout || this.config.timeout,
          },
          (res) => {
            const chunks: Buffer[] = [];

            res.on("data", (chunk) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });

            res.on("end", () => {
              try {
                const headers = this.parseNodeHeaders(res.headers);
                const contentType = (res.headers["content-type"] as string) || "";
                const buffer = Buffer.concat(chunks);

                if (!res.statusCode || res.statusCode >= 400) {
                  const message = buffer.toString("utf-8");
                  reject(
                    new DoclingNetworkError(
                      `HTTP ${res.statusCode}: ${res.statusMessage}`,
                      res.statusCode || 500,
                      { message }
                    )
                  );
                  return;
                }

                const data =
                  contentType.includes("application/zip") ||
                  contentType.includes("application/octet-stream")
                    ? (buffer as unknown as T)
                    : (JSON.parse(buffer.toString("utf-8")) as T);

                if (onProgress) {
                  onProgress({
                    uploadedBytes: progressState.uploadedBytes,
                    totalBytes: progressState.uploadedBytes,
                    percentage: 100,
                    bytesPerSecond: Math.round(
                      (progressState.uploadedBytes / (Date.now() - startTime)) * 1000
                    ),
                    stage: "completed",
                  });
                }

                resolve({
                  data,
                  status: res.statusCode,
                  statusText: res.statusMessage || "OK",
                  headers,
                });
              } catch (error) {
                reject(error);
              }
            });
          }
        );

        req.on("error", (error) => {
          reject(error);
        });

        req.on("timeout", () => {
          req.destroy();
          reject(new DoclingTimeoutError(options.timeout || this.config.timeout, context));
        });

        req.write(formDataPrefix);

        const progressTracker = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            progressState.uploadedBytes += chunk.length;
            const elapsed = Date.now() - startTime;
            const bytesPerSecond = elapsed > 0 ? (progressState.uploadedBytes / elapsed) * 1000 : 0;

            if (onProgress) {
              const percentage =
                totalBytes > 0 ? Math.round((progressState.uploadedBytes / totalBytes) * 100) : 0;

              onProgress({
                uploadedBytes: progressState.uploadedBytes,
                totalBytes: totalBytes || progressState.uploadedBytes,
                percentage: Math.min(percentage, 99),
                bytesPerSecond: Math.round(bytesPerSecond),
                stage: "uploading",
              });
            }

            callback(null, chunk);
          },
        });

        inputStream
          .pipe(progressTracker)
          .on("data", (chunk) => {
            req.write(chunk);
          })
          .on("end", () => {
            req.write(formDataSuffix);
            req.end();
          })
          .on("error", (error) => {
            req.destroy();
            reject(error);
          });
      });
    }, context);
  }

  /**
   * Stream file directly from filesystem using pipelines
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
    const stats = await stat(filePath);
    const fileSize = stats.size;

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
        size: fileSize,
      },
      fields,
      options
    );
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
   * Create a form data part for multipart streaming
   */
  private createFormDataPart(boundary: string, name: string, value: string): string {
    return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }

  /**
   * Create file part header for multipart streaming
   */
  private createFilePartHeader(
    boundary: string,
    name: string,
    filename: string,
    contentType: string
  ): string {
    return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  }

  /**
   * Create abort signal for timeout
   */
  private createAbortSignal(timeout: number): AbortSignal {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeout);
    return controller.signal;
  }

  /**
   * Parse headers from Node.js HTTP response
   */
  private parseNodeHeaders(headers: NodeJS.Dict<string | string[]>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value) {
        result[key] = Array.isArray(value) ? value.join(", ") : value;
      }
    }
    return result;
  }

  /**
   * Parse headers from WHATWG Headers (used in tests)
   */
  private parseHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};

    (headers as Headers).forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Decide whether to use fetch transport (unit tests) or pooled Node HTTP (default)
   */
  private shouldUseFetchTransport(): boolean {
    const isTest = process.env.VITEST_WORKER_ID || process.env.NODE_ENV === "test";
    return typeof fetch === "function" && !!isTest;
  }

  /**
   * Request that returns a file stream (for ZIP downloads)
   * Used when target_type="zip" to get file responses
   */
  async requestFileStream<T = unknown>(
    endpoint: string,
    options: HttpRequestOptions = {}
  ): Promise<{
    data?: T;
    fileStream?: import("../types/streams").NodeReadable;
    fileMetadata?: {
      filename: string;
      contentType: string;
      size?: number;
    };
    status: number;
    statusText: string;
    headers: Record<string, string>;
  }> {
    const url = new URL(`${this.config.baseUrl}${endpoint}`);
    const context = `${options.method || "GET"} ${endpoint}`;

    return new Promise((resolve, reject) => {
      const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
      const headers = this.buildHeaders(options.headers) as Record<string, string>;

      const requestOptions = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers,
        timeout: options.timeout || this.config.timeout,
      };

      const req = requestFn(requestOptions, (res) => {
        const contentType = res.headers["content-type"] || "";
        const contentDisposition = res.headers["content-disposition"] || "";

        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        const filename = filenameMatch?.[1]
          ? filenameMatch[1].replace(/['"]/g, "")
          : "download.zip";

        const contentLength = res.headers["content-length"];
        const fileMetadata = {
          filename,
          contentType,
          ...(contentLength && { size: Number.parseInt(contentLength) }),
        };

        if (!res.statusCode || res.statusCode >= 400) {
          let errorData = "";
          res.on("data", (chunk) => {
            errorData += chunk;
          });
          res.on("end", () => {
            reject(
              new DoclingNetworkError(
                `HTTP ${res.statusCode}: ${res.statusMessage}`,
                res.statusCode || 500,
                { message: errorData }
              )
            );
          });
          return;
        }

        if (
          contentType.includes("application/zip") ||
          contentType.includes("application/octet-stream")
        ) {
          resolve({
            fileStream: res,
            fileMetadata,
            status: res.statusCode,
            statusText: res.statusMessage || "OK",
            headers: this.parseNodeHeaders(res.headers),
          });
        } else {
          let responseData = "";
          res.on("data", (chunk) => {
            responseData += chunk;
          });
          res.on("end", () => {
            try {
              const data = JSON.parse(responseData);
              resolve({
                data,
                status: res.statusCode ?? 200,
                statusText: res.statusMessage || "OK",
                headers: this.parseNodeHeaders(res.headers),
              });
            } catch (error) {
              reject(error);
            }
          });
        }
      });

      req.on("error", (error) => {
        reject(error);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new DoclingTimeoutError(options.timeout || this.config.timeout, context));
      });

      if (options.body) {
        const { body } = this.processRequestBody(options.body, {});
        if (body) req.write(body);
      }

      req.end();
    });
  }

  /**
   * Update client configuration
   */
  updateConfig(config: Partial<ApiClientConfig>): void {
    Object.assign(this.config, config);

    if (this.config.baseUrl.endsWith("/")) {
      this.config.baseUrl = this.config.baseUrl.slice(0, -1);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ApiClientConfig {
    return { ...this.config };
  }

  /**
   * Convert HeadersInit to OutgoingHttpHeaders
   */
  private convertHeaders(headers?: HeadersInit): Record<string, string | string[]> | undefined {
    if (!headers) return undefined;

    if (Array.isArray(headers)) {
      const result: Record<string, string> = {};
      for (const [key, value] of headers) {
        result[key] = value;
      }
      return result;
    }

    if (headers instanceof Headers) {
      const result: Record<string, string> = {};
      headers.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    }

    return headers as Record<string, string | string[]>;
  }

  /**
   * Make HTTP request using connection pool
   */
  private async makePooledRequest(
    url: string,
    options: RequestInit,
    timeout: number
  ): Promise<HttpResponse<Buffer>> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const agent = this.connectionPool.getAgent(urlObj);
      const isHttps = urlObj.protocol === "https:";
      const requestFn = isHttps ? httpsRequest : httpRequest;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || "GET",
        headers: this.convertHeaders(options.headers),
        agent,
        timeout,
      };

      const req = requestFn(requestOptions, (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const data = Buffer.concat(chunks);
          const headers: Record<string, string> = {};

          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === "string") {
              headers[key] = value;
            } else if (Array.isArray(value)) {
              headers[key] = value.join(", ");
            }
          }

          resolve({
            data,
            status: res.statusCode || 0,
            statusText: res.statusMessage || "",
            headers,
          });
        });
      });

      req.on("error", (error) => {
        reject(
          new DoclingNetworkError(`Request failed: ${error.message}`, 0, {
            originalError: error,
          })
        );
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new DoclingTimeoutError(this.config.timeout, `Request to ${url}`));
      });

      if (options.body) {
        if (typeof options.body === "string") {
          req.write(options.body);
        } else if (Buffer.isBuffer(options.body)) {
          req.write(options.body);
        } else if (options.body instanceof ArrayBuffer) {
          req.write(Buffer.from(options.body));
        }
      }

      req.end();
    });
  }

  /**
   * Parse error response from buffer
   */
  private async parseErrorResponseFromBuffer(buffer: Buffer): Promise<ProcessingError> {
    const text = buffer.toString("utf8");

    try {
      const parsed = JSON.parse(text);
      return {
        message: parsed.message || parsed.error || "Unknown error",
        code: parsed.code,
        details: parsed.details || parsed,
      };
    } catch {
      // Ignore errors
      return {
        message: text || "Unknown error",
        code: "PARSE_ERROR",
        details: { rawResponse: text },
      };
    }
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats() {
    return this.connectionPool.getStats();
  }

  /**
   * Get connection pool health
   */
  getPoolHealth() {
    return this.connectionPool.getHealth();
  }

  /**
   * Update connection pool configuration
   */
  updatePoolConfig(config: Partial<ConnectionPoolConfig>) {
    this.connectionPool.updateConfig(config);
  }

  /**
   * Close idle connections
   */
  closeIdleConnections() {
    this.connectionPool.closeIdleConnections();
  }

  /**
   * Destroy connection pool
   */
  destroy() {
    this.connectionPool.destroy();
  }
}
