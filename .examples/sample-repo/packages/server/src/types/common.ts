/**
 * Server-specific types for MCP
 */

import {
  ServerCapabilities,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { Request, Response } from 'express';
import { Socket } from 'socket.io';
import { z } from 'zod';
import { JsonRpcErrorCode } from '@nest-mind/mcp-core';

// Re-export core types
export * from '@nest-mind/mcp-core';

/**
 * WebSocket client with proper typing
 */
export interface WebSocketClient extends Socket {
  id: string;
}

/**
 * HTTP handler function type
 */
export type HttpHandler = (
  req: Request,
  res: Response,
  body?: unknown,
) => Promise<void>;

/**
 * WebSocket handler function type
 */
export type WebSocketHandler = (
  client: WebSocketClient,
  data: unknown,
) => Promise<unknown>;
