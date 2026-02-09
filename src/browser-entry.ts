/**
 * Browser-only entry point for docling-sdk
 * This module is cross-runtime compatible (Browser, Deno, Bun)
 * Does not include CLI-related code (Node.js only)
 *
 * Import from "docling-sdk/browser" for browser-specific bundles
 */

// Core types (API only, no CLI types that reference Node.js)
export * from "./types/docling-core";
export * from "./types/api";

// Re-export common types/errors without CLI types
export {
  DoclingError,
  DoclingNetworkError,
  DoclingValidationError,
  DoclingTimeoutError,
  DoclingFileError,
  DoclingUtils,
} from "./types";
export type { DoclingClientConfig } from "./types";

// Utility exports
export * from "./utils/validation";
export * from "./utils/result";

// Services (cross-runtime compatible)
export { FileService } from "./services/file";
export { ChunkService } from "./services/chunk";

// WebSocket client (cross-runtime)
export {
  DoclingWebSocketClient,
  WebSocketAsyncTask,
} from "./clients/websocket-client";

// API client only (cross-runtime) - direct import to avoid CLI client dependency
import { DoclingAPIClient } from "./clients/api-client";
import type { DoclingAPIConfig } from "./types/client";

export { DoclingAPIClient };

/**
 * Create an API client (browser-compatible version)
 */
export function createAPIClient(
  baseUrl: string,
  options?: Partial<Omit<DoclingAPIConfig, "type" | "baseUrl">>
): DoclingAPIClient {
  return new DoclingAPIClient({
    type: "api" as const,
    baseUrl,
    ...options,
  });
}

/**
 * Type guard to check if client is API type
 */
export function isAPIClient(client: unknown): client is DoclingAPIClient {
  return client instanceof DoclingAPIClient || (client as { type: string })?.type === "api";
}

// Task manager (cross-runtime)
export { AsyncTaskManager } from "./services/async-task-manager";

// Web client (browser-based OCR)
import { DoclingWebClient } from "./clients/web-client";
import type { DoclingWebClientConfig } from "./types/web";

export { DoclingWebClient };

/**
 * Create a Web client (browser-compatible version)
 */
export function createWebClient(
  options?: Partial<Omit<DoclingWebClientConfig, "type">>
): DoclingWebClient {
  return new DoclingWebClient({
    type: "web" as const,
    ...options,
  });
}

/**
 * Type guard to check if client is Web type
 */
export function isWebClient(client: unknown): client is DoclingWebClient {
  return client instanceof DoclingWebClient || (client as { type: string })?.type === "web";
}

// Client types (API + Web, no CLI types)
export type {
  DoclingAPIConfig,
  DoclingClientBase,
  DoclingWeb,
  ProgressConfig,
  ProgressUpdate,
  SafeConversionResult,
  SafeFileConversionResult,
} from "./types/client";

// Web types
export type {
  DoclingWebClientConfig,
  DoclingWebConfig,
  WebOCRResult,
  WebOCRDocument,
  ImageInput,
  WebProcessOptions,
  WebClientEvents,
  ExtractedTable,
  ElementOverlay,
} from "./types/web";

// Validation
export { ZodValidation } from "./validation/schemas";

// Platform abstractions (cross-runtime)
export {
  CrossEventEmitter,
  createEventEmitter,
} from "./platform/events";

export {
  delay,
  timeout,
  withTimeout,
  retry,
} from "./platform/timers";

export {
  createBinary,
  binaryToString,
  stringToUint8Array,
  uint8ArrayToString,
  binaryToBlob,
  base64ToUint8Array,
  uint8ArrayToBase64,
  randomUUID,
} from "./platform/binary";

export {
  isNode,
  isBrowser,
  isDeno,
  isBun,
  hasNativeWebSocket,
  hasNativeFetch,
} from "./platform/detection";

export { PlatformHttpClient } from "./platform/http";

export {
  CrossWebSocket,
  createWebSocketAdapter,
} from "./platform/websocket";

// Platform types
export type {
  HttpClientConfig,
  HttpResponse,
  HttpRequestOptions,
  ExtendedHttpOptions,
  FileUploadInfo,
  UploadProgress,
  WebSocketHooks,
  WebSocketPeer,
  WebSocketMessage,
  WebSocketClientOptions,
  WebSocketState,
} from "./platform/types";

export type { BinaryData } from "./platform/binary";
export type { EventMap, EventHandler, WildcardEventHandler } from "./platform/events";
