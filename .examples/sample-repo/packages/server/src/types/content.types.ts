/**
 * Type definitions for MCP content and responses
 */

/**
 * Content type enum for MCP responses
 */
export enum ContentType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  FILE = 'file',
  HTML = 'html',
  JSON = 'json',
  ERROR = 'error',
}

/**
 * Base content item interface
 */
export interface BaseContent {
  type: string;
}

/**
 * Text content interface
 */
export interface TextContent extends BaseContent {
  type: ContentType.TEXT | 'text';
  text: string;
}

/**
 * Error content interface
 */
export interface ErrorContent extends BaseContent {
  type: ContentType.ERROR | 'error';
  text: string;
}

/**
 * Image content interface
 */
export interface ImageContent extends BaseContent {
  type: ContentType.IMAGE | 'image';
  data: string;
  mimeType: string;
}

/**
 * Audio content interface
 */
export interface AudioContent extends BaseContent {
  type: ContentType.AUDIO | 'audio';
  data: string;
  mimeType: string;
}

/**
 * Video content interface
 */
export interface VideoContent extends BaseContent {
  type: ContentType.VIDEO | 'video';
  data: string;
  mimeType: string;
}

/**
 * File content interface
 */
export interface FileContent extends BaseContent {
  type: ContentType.FILE | 'file';
  data: string;
  mimeType: string;
  filename?: string;
}

/**
 * HTML content interface
 */
export interface HtmlContent extends BaseContent {
  type: ContentType.HTML | 'html';
  html: string;
}

/**
 * JSON content interface
 */
export interface JsonContent extends BaseContent {
  type: ContentType.JSON | 'json';
  json: Record<string, unknown>;
}

/**
 * Union type for all content types
 */
export type Content =
  | TextContent
  | ErrorContent
  | ImageContent
  | AudioContent
  | VideoContent
  | FileContent
  | HtmlContent
  | JsonContent;

/**
 * MCP tool response interface
 */
export interface ToolResponse {
  content: Content[];
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * MCP resource content interface
 */
export interface ResourceContent {
  uri: string;
  text?: string;
  blob?: string;
  mimeType?: string;
}

/**
 * MCP resource response interface
 */
export interface ResourceResponse {
  contents: ResourceContent[];
}

/**
 * MCP prompt message interface
 */
export interface PromptMessage {
  role: 'user' | 'assistant' | 'system';
  content: Content;
}

/**
 * MCP prompt response interface
 */
export interface PromptResponse {
  messages: PromptMessage[];
  description?: string;
}

/**
 * Type guard to check if a value is a TextContent
 */
export function isTextContent(value: unknown): value is TextContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as TextContent).type === ContentType.TEXT &&
    'text' in value &&
    typeof (value as TextContent).text === 'string'
  );
}

/**
 * Type guard to check if a value is an ErrorContent
 */
export function isErrorContent(value: unknown): value is ErrorContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as ErrorContent).type === ContentType.ERROR &&
    'text' in value &&
    typeof (value as ErrorContent).text === 'string'
  );
}

/**
 * Type guard to check if a value is an ImageContent
 */
export function isImageContent(value: unknown): value is ImageContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as ImageContent).type === ContentType.IMAGE &&
    'data' in value &&
    typeof (value as ImageContent).data === 'string' &&
    'mimeType' in value &&
    typeof (value as ImageContent).mimeType === 'string'
  );
}

/**
 * Type guard to check if a value is a Content
 */
export function isContent(value: unknown): value is Content {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Content).type === 'string'
  );
}

/**
 * Type guard to check if a value is a ToolResponse
 */
export function isToolResponse(value: unknown): value is ToolResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    Array.isArray((value as ToolResponse).content) &&
    (value as ToolResponse).content.every(isContent)
  );
}

/**
 * Type guard to check if a value is a ResourceResponse
 */
export function isResourceResponse(value: unknown): value is ResourceResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'contents' in value &&
    Array.isArray((value as ResourceResponse).contents) &&
    (value as ResourceResponse).contents.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'uri' in item &&
        typeof item.uri === 'string',
    )
  );
}

/**
 * Type guard to check if a value is a PromptResponse
 */
export function isPromptResponse(value: unknown): value is PromptResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'messages' in value &&
    Array.isArray((value as PromptResponse).messages) &&
    (value as PromptResponse).messages.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'role' in item &&
        ['user', 'assistant', 'system'].includes(item.role) &&
        'content' in item &&
        isContent(item.content),
    )
  );
}
