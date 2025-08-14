import { McpServer as ModelContextProtocolServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CallToolRequestSchema,
  ReadResourceRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Request as ExpressRequest } from 'express';

/**
 * Re-export the McpServer type from the ModelContextProtocol library
 */
export type McpServer = ModelContextProtocolServer;

/**
 * Generic MCP request type
 */
export type McpGenericRequest = {
  params: {
    _meta?: {
      progressToken?: string | number;
    };
    [key: string]: unknown;
  };
  method: string;
};

/**
 * Interface for MCP request with nullable option
 */
export type NullableMcpRequest =
  | z.infer<typeof CallToolRequestSchema>
  | z.infer<typeof ReadResourceRequestSchema>
  | z.infer<typeof ListResourcesRequestSchema>
  | z.infer<typeof ListToolsRequestSchema>
  | McpGenericRequest
  | null;

/**
 * Interface for HTTP request with nullable option
 */
export type NullableHttpRequest = ExpressRequest | null;
