/**
 * Utility functions for creating standardized MCP responses
 */
import { ContentType } from '../types/content.types';

/**
 * Content item interface for MCP responses
 */
export interface ContentItem {
  type: ContentType | string;
  text?: string;
  url?: string;
  mimeType?: string;
  data?: unknown;
}

/**
 * Standard MCP response interface
 */
export interface McpResponse {
  content?: ContentItem[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Create a standardized MCP response
 * @param content Content items or a single content item
 * @param isError Whether the response represents an error
 * @param metadata Additional metadata for the response
 * @returns A standardized MCP response
 */
export function createResponse(
  content: ContentItem | ContentItem[] | string,
  isError = false,
  metadata?: Record<string, unknown>,
): McpResponse {
  if (typeof content === 'string') {
    content = [{ type: ContentType.TEXT, text: content }];
  }

  if (!Array.isArray(content)) {
    content = [content];
  }

  return {
    content,
    ...(isError ? { isError } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * Create a text response
 * @param text Text content
 * @param isError Whether the response represents an error
 * @param metadata Additional metadata for the response
 * @returns A standardized MCP response with text content
 */
export function createTextResponse(
  text: string,
  isError = false,
  metadata?: Record<string, unknown>,
): McpResponse {
  return createResponse({ type: ContentType.TEXT, text }, isError, metadata);
}

/**
 * Create a JSON response
 * @param data JSON data
 * @param isError Whether the response represents an error
 * @param metadata Additional metadata for the response
 * @returns A standardized MCP response with JSON content
 */
export function createJsonResponse(
  data: unknown,
  isError = false,
  metadata?: Record<string, unknown>,
): McpResponse {
  return createResponse(
    {
      type: ContentType.JSON,
      data,
      text: typeof data === 'string' ? data : JSON.stringify(data),
    },
    isError,
    metadata,
  );
}

/**
 * Create an error response
 * @param error Error object or error message
 * @param metadata Additional metadata for the response
 * @returns A standardized MCP error response
 */
export function createErrorResponse(
  error: Error | string,
  metadata?: Record<string, unknown>,
): McpResponse {
  const errorMessage = error instanceof Error ? error.message : error;
  return createTextResponse(`Error: ${errorMessage}`, true, {
    ...(error instanceof Error ? { stack: error.stack } : {}),
    ...metadata,
  });
}

/**
 * Create a structured content response
 * @param structuredContent Structured content data
 * @param isError Whether the response represents an error
 * @param metadata Additional metadata for the response
 * @returns A standardized MCP response with structured content
 */
export function createStructuredResponse(
  structuredContent: Record<string, unknown>,
  isError = false,
  metadata?: Record<string, unknown>,
): McpResponse {
  // For backward compatibility, also include a text representation
  const textContent = {
    type: ContentType.TEXT,
    text: JSON.stringify(structuredContent, null, 2),
  };

  return {
    structuredContent,
    content: [textContent],
    ...(isError ? { isError } : {}),
    ...(metadata ? { metadata } : {}),
  };
}
