import { Socket } from 'socket.io';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Interface for WebSocket client
 */
export interface WebSocketClient extends Socket {
  /**
   * Client ID
   */
  id: string;

  /**
   * Authentication information
   */
  auth?: Record<string, unknown>;

  /**
   * Additional client metadata
   */
  [key: string]: unknown;
}

/**
 * Interface for WebSocket connection
 */
export interface WebSocketConnection {
  /**
   * Connection ID
   */
  id: string;

  /**
   * WebSocket client
   */
  client: WebSocketClient;

  /**
   * MCP server instance
   */
  server: McpServer;

  /**
   * Whether this is a test connection
   */
  isTestConnection?: boolean;

  /**
   * Additional connection metadata
   */
  [key: string]: unknown;
}
