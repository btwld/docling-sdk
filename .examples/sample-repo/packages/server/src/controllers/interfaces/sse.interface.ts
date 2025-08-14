import { Response } from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Interface for SSE connection
 */
export interface SseConnection {
  /**
   * Connection ID
   */
  id: string;

  /**
   * Express response object
   */
  res: Response;

  /**
   * SSE transport
   */
  transport: SSEServerTransport;

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
