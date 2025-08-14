/**
 * Common types used throughout the MCP ecosystem
 */

import {
  ServerCapabilities,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/**
 * MCP transport types
 */
export enum McpTransportType {
  STDIO = 'stdio',
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable-http',
  WEBSOCKET = 'websocket',
  CUSTOM = 'custom',
}

/**
 * MCP server capabilities with proper typing
 */
export interface TypedServerCapabilities extends ServerCapabilities {
  tools?: Record<
    string,
    {
      description?: string;
      schema?: unknown;
      annotations?: ToolAnnotations;
    }
  >;
  resources?: Record<
    string,
    {
      description?: string;
      schema?: unknown;
      uri?: string;
      mimeType?: string;
    }
  >;
  prompts?: Record<
    string,
    {
      description?: string;
      schema?: unknown;
      parameters?: z.ZodTypeAny;
    }
  >;
  notifications?: boolean;
  logging?: Record<string, unknown>;
}

/**
 * Base decorator metadata interface
 */
export interface BaseMetadata {
  name?: string;
  description?: string;
}

/**
 * Tool metadata interface
 */
export interface ToolMetadata extends BaseMetadata {
  parameters?: z.ZodTypeAny;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/**
 * Resource metadata interface
 */
export interface ResourceMetadata extends BaseMetadata {
  uri: string;
  mimeType?: string;
}

/**
 * Prompt argument interface
 */
export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * Prompt metadata interface
 */
export interface PromptMetadata extends BaseMetadata {
  name: string;
  arguments?: PromptArgument[];
}
