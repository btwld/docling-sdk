/**
 * Type definitions for MCP capabilities
 */
import { z } from 'zod';

/**
 * Tool annotation interface
 */
export interface ToolAnnotations {
  /**
   * If true, the tool may perform destructive updates
   * Only meaningful when readOnlyHint is false
   * @default true
   */
  destructiveHint?: boolean;

  /**
   * If true, calling the tool repeatedly with the same arguments has no additional effect
   * Only meaningful when readOnlyHint is false
   * @default false
   */
  idempotentHint?: boolean;

  /**
   * If true, the tool may interact with an "open world" of external entities
   * @default true
   */
  openWorldHint?: boolean;

  /**
   * If true, indicates the tool does not modify its environment
   * @default false
   */
  readOnlyHint?: boolean;

  /**
   * A human-readable title for the tool, useful for UI display
   */
  title?: string;
}

/**
 * Tool capability interface
 */
export interface ToolCapability {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/**
 * Resource capability interface
 */
export interface ResourceCapability {
  name: string;
  description?: string;
  uri: string;
  mimeType?: string;
}

/**
 * Resource template capability interface
 */
export interface ResourceTemplateCapability {
  name: string;
  description?: string;
  uriTemplate: string;
  arguments: ResourceTemplateArgument[];
  mimeType?: string;
}

/**
 * Resource template argument interface
 */
export interface ResourceTemplateArgument {
  name: string;
  description?: string;
}

/**
 * Prompt capability interface
 */
export interface PromptCapability {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

/**
 * Prompt argument interface
 */
export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
  enum?: string[];
}

/**
 * Server capabilities interface
 */
export interface ServerCapabilities {
  tools?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
  notifications?: boolean;
  logging?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Typed server capabilities interface
 */
export interface TypedServerCapabilities {
  tools?: Record<string, ToolCapability>;
  resources?: Record<string, ResourceCapability>;
  prompts?: Record<string, PromptCapability>;
  notifications?: boolean;
  logging?: Record<string, unknown>;
}

/**
 * Tool metadata interface
 */
export interface ToolMetadata {
  name: string;
  description?: string;
  parameters?: z.ZodTypeAny;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/**
 * Resource metadata interface
 */
export interface ResourceMetadata {
  name: string;
  description?: string;
  uri: string;
  mimeType?: string;
}

/**
 * Prompt metadata interface
 */
export interface PromptMetadata {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

/**
 * Type guard to check if a value is a ToolCapability
 */
export function isToolCapability(value: unknown): value is ToolCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as ToolCapability).name === 'string'
  );
}

/**
 * Type guard to check if a value is a ResourceCapability
 */
export function isResourceCapability(
  value: unknown,
): value is ResourceCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as ResourceCapability).name === 'string' &&
    'uri' in value &&
    typeof (value as ResourceCapability).uri === 'string'
  );
}

/**
 * Type guard to check if a value is a PromptCapability
 */
export function isPromptCapability(value: unknown): value is PromptCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as PromptCapability).name === 'string'
  );
}
