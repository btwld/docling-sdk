/**
 * Transport-related types
 */

import { McpTransportType } from './common';

/**
 * Base transport options interface
 */
export interface BaseTransportOptions {
  type: McpTransportType;
}

/**
 * WebSocket transport options
 */
export interface WebSocketTransportOptions extends BaseTransportOptions {
  type: McpTransportType.WEBSOCKET;
  endpoint?: string;
  port?: number;
  cors?: {
    origin?: string | string[] | boolean;
    credentials?: boolean;
  };
}

/**
 * Server-Sent Events transport options
 */
export interface SseTransportOptions extends BaseTransportOptions {
  type: McpTransportType.SSE;
  endpoint?: string;
  pingInterval?: number;
}

/**
 * StreamableHTTP transport options
 */
export interface StreamableHttpTransportOptions extends BaseTransportOptions {
  type: McpTransportType.STREAMABLE_HTTP;
  endpoint?: string;
  enableResumability?: boolean;
}

/**
 * STDIO transport options
 */
export interface StdioTransportOptions extends BaseTransportOptions {
  type: McpTransportType.STDIO;
}

/**
 * Custom transport options
 */
export interface CustomTransportOptions extends BaseTransportOptions {
  type: McpTransportType.CUSTOM;
  customTransportProvider?: any;
}

/**
 * Union type for all transport options
 */
export type TransportOptions =
  | WebSocketTransportOptions
  | SseTransportOptions
  | StreamableHttpTransportOptions
  | StdioTransportOptions
  | CustomTransportOptions;
