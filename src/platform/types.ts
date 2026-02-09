/**
 * Shared type definitions for cross-runtime platform abstractions
 */

import type { BinaryData } from "./binary";

/**
 * HTTP request options for the cross-runtime HTTP client
 */
export interface HttpRequestOptions {
  /** HTTP method */
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: string | BinaryData | FormData | ReadableStream<Uint8Array>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Number of retry attempts */
  retry?: number;
  /** Delay between retries in milliseconds */
  retryDelay?: number;
  /** Status codes that should trigger a retry */
  retryStatusCodes?: number[];
  /** Abort signal */
  signal?: AbortSignal;
  /** Response type hint */
  responseType?: "json" | "text" | "binary" | "stream";
}

/**
 * HTTP response from the cross-runtime HTTP client
 */
export interface HttpResponse<T = unknown> {
  /** Response data */
  data: T;
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
  /** Original response object (runtime-specific) */
  _raw?: Response;
}

/**
 * HTTP client configuration
 */
export interface HttpClientConfig {
  /** Base URL for all requests */
  baseUrl: string;
  /** Default timeout in milliseconds */
  timeout?: number;
  /** Default headers for all requests */
  headers?: Record<string, string>;
  /** Default number of retry attempts */
  retry?: number;
  /** Default retry delay in milliseconds */
  retryDelay?: number;
  /** Status codes that should trigger a retry */
  retryStatusCodes?: number[];
}

/**
 * File upload information
 */
export interface FileUploadInfo {
  /** Form field name */
  name: string;
  /** File data */
  data: BinaryData | string;
  /** Filename */
  filename?: string;
  /** Content type (MIME type) */
  contentType?: string;
}

/**
 * Upload progress callback
 */
export interface UploadProgress {
  /** Bytes uploaded so far */
  uploadedBytes: number;
  /** Total bytes to upload */
  totalBytes: number;
  /** Upload percentage (0-100) */
  percentage: number;
  /** Current file being uploaded */
  currentFile: string;
  /** Upload stage */
  stage: "preparing" | "uploading" | "processing" | "completed";
}

/**
 * WebSocket hooks interface (crossws-style)
 */
export interface WebSocketHooks {
  /** Called when connection is established */
  open?: (peer: WebSocketPeer) => void;
  /** Called when a message is received */
  message?: (peer: WebSocketPeer, message: WebSocketMessage) => void;
  /** Called when connection is closed */
  close?: (peer: WebSocketPeer, event: { code: number; reason: string }) => void;
  /** Called when an error occurs */
  error?: (peer: WebSocketPeer, error: Error) => void;
}

/**
 * WebSocket peer interface (crossws-style)
 */
export interface WebSocketPeer {
  /** Unique identifier for this peer */
  id: string;
  /** WebSocket ready state */
  readyState: number;
  /** Send data to the peer */
  send(data: string | BinaryData): void;
  /** Close the connection */
  close(code?: number, reason?: string): void;
  /** WebSocket URL */
  url: string;
}

/**
 * WebSocket message interface
 */
export interface WebSocketMessage {
  /** Message type */
  type: "text" | "binary";
  /** Message data */
  data: string | BinaryData;
  /** Parse data as JSON */
  json<T = unknown>(): T;
  /** Get data as text */
  text(): string;
}

/**
 * WebSocket client options
 */
export interface WebSocketClientOptions {
  /** WebSocket URL */
  url: string;
  /** WebSocket subprotocols */
  protocols?: string | string[];
  /** Reconnect automatically on disconnect */
  reconnect?: boolean;
  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
  /** Delay between reconnect attempts (ms) */
  reconnectDelay?: number;
  /** Heartbeat/ping interval (ms) */
  heartbeatInterval?: number;
  /** Connection timeout (ms) */
  timeout?: number;
}

/**
 * WebSocket connection state
 */
export type WebSocketState = "connecting" | "connected" | "disconnected" | "reconnecting" | "error";

/**
 * ofetch interceptor context
 */
export interface FetchContext {
  /** Request URL */
  request: string;
  /** Request options */
  options: RequestInit & { baseURL?: string };
  /** Response object (only in response interceptors) */
  response?: Response;
  /** Error object (only in error interceptors) */
  error?: Error;
}

/**
 * ofetch interceptors
 */
export interface FetchInterceptors {
  /** Called before request is sent */
  onRequest?: (context: FetchContext) => void | Promise<void>;
  /** Called after response is received */
  onResponse?: (context: FetchContext) => void | Promise<void>;
  /** Called when request fails */
  onRequestError?: (context: FetchContext) => void | Promise<void>;
  /** Called when response status is an error */
  onResponseError?: (context: FetchContext) => void | Promise<void>;
}

/**
 * Extended HTTP client options with ofetch-specific features
 */
export interface ExtendedHttpOptions extends HttpRequestOptions, FetchInterceptors {
  /** Query parameters */
  query?: Record<string, string | number | boolean | undefined>;
  /** Parse response as JSON (default: auto-detect) */
  parseResponse?: boolean;
  /** Ignore response errors (don't throw on 4xx/5xx) */
  ignoreResponseError?: boolean;
}

/**
 * Processing error from API responses
 */
export interface ProcessingError {
  /** Error message */
  message: string;
  /** Error code */
  code?: string;
  /** Additional error details */
  details?: unknown;
}

/**
 * Stream reading options
 */
export interface StreamReadOptions {
  /** Chunk size in bytes (for chunked reading) */
  chunkSize?: number;
  /** Maximum bytes to read */
  maxBytes?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Progress callback */
  onProgress?: (bytesRead: number, totalBytes?: number) => void;
}
