import { InjectionToken, Type } from '@nestjs/common';
import { z } from 'zod';

/**
 * Interface for tool metadata
 */
export interface ToolMetadata {
  name: string;
  description?: string;
  parameters?: z.ZodTypeAny | Type<unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: z.ZodTypeAny | Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * Interface for resource metadata
 */
export interface ResourceMetadata {
  name: string;
  description?: string;
  uri: string;
  mimeType?: string;
}

/**
 * Interface for discovered tool
 */
export interface DiscoveredTool {
  type: 'tool' | 'resource' | 'prompt';
  metadata: ToolMetadata | ResourceMetadata;
  providerClass: InjectionToken;
  methodName: string;
}

/**
 * Interface for discovered resource with params
 */
export interface DiscoveredResourceWithParams {
  resource: DiscoveredTool;
  params: Record<string, string>;
}

/**
 * Interface for MCP request
 */
export interface McpRequest {
  params: {
    name?: string;
    uri?: string;
    arguments?: Record<string, unknown>;
    _meta?: {
      progressToken?: string;
    };
    [key: string]: unknown;
  };
}
