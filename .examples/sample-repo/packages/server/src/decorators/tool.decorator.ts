import { SetMetadata, Type } from '@nestjs/common';
import { MCP_TOOL_METADATA_KEY } from './constants';
import { z } from 'zod';

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny | Type<any>;
  inputSchema?: any;
  outputSchema?: z.ZodTypeAny | Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface ToolOptions {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny | Type<any>;
  inputSchema?: any;
  outputSchema?: z.ZodTypeAny | Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * Decorator that marks a controller method as an MCP tool.
 * @param options - The options for the decorator
 * @param options.name - The name of the tool
 * @param options.description - The description of the tool
 * @param options.parameters - The parameters of the tool (Zod schema or DTO class)
 * @param options.inputSchema - The JSON Schema for the input (alternative to parameters)
 * @param options.outputSchema - The schema for the tool's structured output (Zod schema or JSON Schema)
 * @param options.annotations - Additional tool annotations
 * @returns The decorator
 */
export const Tool = (options: ToolOptions) => {
  return SetMetadata(MCP_TOOL_METADATA_KEY, options);
};
