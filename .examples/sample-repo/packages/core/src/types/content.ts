/**
 * Content types for MCP messages
 */

/**
 * Content type enumeration
 */
export enum ContentType {
  TEXT = 'text',
  IMAGE = 'image',
  RESOURCE = 'resource',
}

/**
 * Base content interface
 */
export interface BaseContent {
  type: ContentType;
  annotations?: Record<string, unknown>;
}

/**
 * Text content interface
 */
export interface TextContent extends BaseContent {
  type: ContentType.TEXT;
  text: string;
}

/**
 * Image content interface
 */
export interface ImageContent extends BaseContent {
  type: ContentType.IMAGE;
  data: string;
  mimeType: string;
}

/**
 * Resource content interface
 */
export interface ResourceContent extends BaseContent {
  type: ContentType.RESOURCE;
  resource: {
    uri: string;
    text?: string;
    mimeType?: string;
  };
}

/**
 * Union type for all content types
 */
export type Content = TextContent | ImageContent | ResourceContent;
