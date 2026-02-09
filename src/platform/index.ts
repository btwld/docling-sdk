/**
 * Platform abstraction layer for cross-runtime compatibility
 * Provides runtime-agnostic interfaces for Node.js, Bun, Deno, and browsers
 */

// Runtime detection
export {
  detectRuntime,
  getRuntimeInfo,
  isBrowser,
  isBun,
  isDeno,
  isNode,
  isServer,
  hasNativeWebSocket,
  hasNativeFetch,
  hasWebStreams,
  hasAbortController,
  hasFormData,
  hasBlob,
  hasFile,
  hasRandomUUID,
  type RuntimeEnvironment,
} from "./detection";

// Event emitter (mitt-based)
export {
  CrossEventEmitter,
  createEventEmitter,
  mitt,
  type EventMap,
  type EventHandler,
  type WildcardEventHandler,
} from "./events";

// Timer utilities
export {
  delay,
  setTimeout,
  timeout,
  createTimeoutController,
  withTimeout,
  debounce,
  throttle,
  interval,
  retry,
} from "./timers";

// Binary utilities
export {
  createBinary,
  binaryToString,
  stringToUint8Array,
  uint8ArrayToString,
  base64ToUint8Array,
  uint8ArrayToBase64,
  hexToUint8Array,
  uint8ArrayToHex,
  concatBinary,
  sliceBinary,
  equalsBinary,
  viewBinary,
  isBinary,
  isNodeBuffer,
  bufferToUint8Array,
  binaryToBlob,
  blobToBinary,
  streamToBinary,
  binaryToStream,
  randomUUID,
  type BinaryData,
} from "./binary";

// HTTP client (ofetch-based)
export {
  PlatformHttpClient,
  createHttpClient,
  $fetch,
  ofetch,
  type FetchOptions,
  type FetchError,
} from "./http";

// WebSocket (crossws-style)
export {
  CrossWebSocket,
  createCrossWebSocket,
  createWebSocketAdapter,
  connectWebSocket,
  type WebSocketAdapter,
  type WebSocketAdapterFactory,
  type WebSocketAdapterOptions,
  type WebSocketCloseEvent,
  type WebSocketErrorEvent,
  type WebSocketHooks as PlatformWebSocketHooks,
  type WebSocketMessage as PlatformWebSocketMessage,
  type WebSocketMessageEvent,
  type WebSocketPeer as PlatformWebSocketPeer,
} from "./websocket";

// WebSocket constants
export { WebSocketReadyState } from "./websocket/types";

// Shared types
export type {
  HttpRequestOptions,
  HttpResponse,
  HttpClientConfig,
  FileUploadInfo,
  UploadProgress,
  WebSocketHooks,
  WebSocketPeer,
  WebSocketMessage,
  WebSocketClientOptions,
  WebSocketState,
  FetchContext,
  FetchInterceptors,
  ExtendedHttpOptions,
  ProcessingError,
  StreamReadOptions,
} from "./types";
