/**
 * Type definitions for MCP transports
 */
import { JsonRpcMessage } from './json-rpc.types';
import { ServerCapabilities } from './capability.types';
import { AuthInfo } from './auth.types';

/**
 * Transport type enum
 */
export enum TransportType {
  STDIO = 'stdio',
  SSE = 'sse',
  HTTP_STREAM = 'http-stream',
  WEBSOCKET = 'websocket',
}

/**
 * Base transport interface
 */
export interface BaseTransportConfig {
  auth?: AuthInfo;
}

/**
 * CORS configuration interface
 */
export interface CorsConfig {
  /**
   * Allowed origins
   * @default "*"
   */
  allowOrigin?: string;

  /**
   * Allowed methods
   * @default "GET, POST, OPTIONS"
   */
  allowMethods?: string;

  /**
   * Allowed headers
   * @default "Content-Type, Accept, Authorization"
   */
  allowHeaders?: string;

  /**
   * Exposed headers
   * @default "Content-Type"
   */
  exposeHeaders?: string;

  /**
   * Max age in seconds
   * @default "86400"
   */
  maxAge?: string;
}

/**
 * SSE transport configuration interface
 */
export interface SseTransportConfig extends BaseTransportConfig {
  /**
   * Port to listen on
   * @default 3000
   */
  port?: number;

  /**
   * SSE endpoint path
   * @default "/sse"
   */
  endpoint?: string;

  /**
   * Messages endpoint path
   * @default "/messages"
   */
  messageEndpoint?: string;

  /**
   * Maximum message size
   * @default "1mb"
   */
  maxMessageSize?: string;

  /**
   * CORS configuration
   */
  cors?: CorsConfig;

  /**
   * Additional headers
   */
  headers?: Record<string, string>;
}

/**
 * HTTP stream transport configuration interface
 */
export interface HttpStreamTransportConfig extends BaseTransportConfig {
  /**
   * Port to listen on
   * @default 8080
   */
  port?: number;

  /**
   * HTTP endpoint path
   * @default "/mcp"
   */
  endpoint?: string;

  /**
   * Maximum message size
   * @default "4mb"
   */
  maxMessageSize?: string;

  /**
   * Response mode
   * @default "batch"
   */
  responseMode?: 'stream' | 'batch';

  /**
   * Batch timeout in milliseconds
   * @default 30000
   */
  batchTimeout?: number;

  /**
   * Additional headers
   */
  headers?: Record<string, string>;

  /**
   * CORS configuration
   */
  cors?: CorsConfig;

  /**
   * Session configuration
   */
  session?: {
    /**
     * Whether to enable session management
     * @default true
     */
    enabled?: boolean;

    /**
     * Session ID header name
     * @default "Mcp-Session-Id"
     */
    headerName?: string;

    /**
     * Whether to allow client session termination
     * @default true
     */
    allowClientTermination?: boolean;
  };

  /**
   * Resumability configuration
   */
  resumability?: {
    /**
     * Whether to enable resumability
     * @default false
     */
    enabled?: boolean;

    /**
     * History duration in milliseconds
     * @default 300000
     */
    historyDuration?: number;

    /**
     * Message store type
     * @default "global"
     */
    messageStoreType?: 'connection' | 'global';
  };

  /**
   * Whether to enable GET SSE
   * @default true
   */
  enableGetSse?: boolean;
}

/**
 * WebSocket transport configuration interface
 */
export interface WebSocketTransportConfig extends BaseTransportConfig {
  /**
   * Port to listen on
   * @default 3000
   */
  port?: number;

  /**
   * WebSocket endpoint path
   * @default "/ws"
   */
  path?: string;

  /**
   * CORS configuration
   */
  cors?: {
    /**
     * Allowed origins
     * @default "*"
     */
    origin?: string | string[];

    /**
     * Whether to allow credentials
     * @default true
     */
    credentials?: boolean;
  };

  /**
   * Custom WebSocket protocols
   */
  protocols?: string[];

  /**
   * Additional headers
   */
  headers?: Record<string, string>;
}

/**
 * Transport configuration type
 */
export type TransportConfig =
  | {
      type: TransportType.STDIO;
    }
  | {
      type: TransportType.SSE;
      options?: SseTransportConfig;
    }
  | {
      type: TransportType.HTTP_STREAM;
      options?: HttpStreamTransportConfig;
    }
  | {
      type: TransportType.WEBSOCKET;
      options?: WebSocketTransportConfig;
    };

/**
 * MCP server configuration interface
 */
export interface McpServerConfig {
  /**
   * Server name
   */
  name: string;

  /**
   * Server version
   */
  version: string;

  /**
   * Base path for loading capabilities
   */
  basePath?: string;

  /**
   * Transport configuration
   */
  transport?: TransportConfig | TransportConfig[];

  /**
   * Server instructions
   */
  instructions?: string;

  /**
   * Server capabilities
   */
  capabilities?: ServerCapabilities;
}

/**
 * Transport event handler interface
 */
export interface TransportEventHandlers {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JsonRpcMessage) => void;
}

/**
 * Transport interface
 */
export interface Transport extends TransportEventHandlers {
  /**
   * Transport type
   */
  readonly type: string;

  /**
   * Start the transport
   */
  start(): Promise<void>;

  /**
   * Send a message
   */
  send(message: JsonRpcMessage): Promise<void>;

  /**
   * Close the transport
   */
  close(): Promise<void>;

  /**
   * Check if the transport is running
   */
  isRunning(): boolean;
}
