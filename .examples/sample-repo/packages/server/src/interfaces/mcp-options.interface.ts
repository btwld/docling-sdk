import { ModuleMetadata, Type } from '@nestjs/common';
import { CanActivate } from '@nestjs/common';
import { McpTransportProvider } from './mcp-transport.interface';
import { McpTransportType } from '../types/common';

/**
 * SSE transport options
 */
export interface SseTransportOptions {
  endpoint?: string;
  messagesEndpoint?: string;
  pingInterval?: number;
  pingEnabled?: boolean;
  pingIntervalMs?: number;
}

/**
 * StreamableHTTP transport options
 */
export interface StreamableHttpTransportOptions {
  endpoint?: string;
  enableResumability?: boolean;
  resumabilityTimeout?: number;
  statelessMode?: boolean;
  sessionIdGenerator?: () => string;
  enableJsonResponse?: boolean;
  enableHealthMonitor?: boolean;
}

/**
 * WebSocket transport options
 */
export interface WebSocketTransportOptions {
  endpoint?: string;
  namespace?: string;
  protocol?: string;
  cors?: {
    origin?: string | string[];
    credentials?: boolean;
  };
  socketIoOptions?: Record<string, any>;
  sessionTimeout?: number;
  protocolOptions?: Record<string, any>;
}

/**
 * MCP options interface
 */
export interface McpOptions {
  /**
   * Server name
   */
  name: string;

  /**
   * Server version
   */
  version: string;

  /**
   * Transport type(s) to use
   */
  transport?: McpTransportType | McpTransportType[];

  /**
   * Custom transport provider (required when using McpTransportType.CUSTOM)
   */
  customTransportProvider?: McpTransportProvider;

  /**
   * SSE transport options
   */
  sse?: SseTransportOptions;

  /**
   * StreamableHTTP transport options
   */
  streamableHttp?: StreamableHttpTransportOptions;

  /**
   * WebSocket transport options
   */
  websocket?: WebSocketTransportOptions;

  /**
   * Session options
   */
  session?: {
    sessionTimeout?: number;
  };

  /**
   * Global API prefix
   */
  globalApiPrefix?: string;

  /**
   * Server capabilities
   */
  capabilities?: Record<string, any>;

  /**
   * Server instructions
   */
  instructions?: string;

  /**
   * Guards to apply to all endpoints
   */
  guards?: Type<CanActivate>[];

  /**
   * Legacy options for backward compatibility
   */
  sseEndpoint?: string;
  messagesEndpoint?: string;
}

export interface McpOptionsFactory {
  createMcpOptions(): Promise<McpOptions> | McpOptions;
}

export interface McpAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<McpOptionsFactory>;
  useClass?: Type<McpOptionsFactory>;
  useFactory?: (...args: any[]) => Promise<McpOptions> | McpOptions;
  inject?: any[];
}
