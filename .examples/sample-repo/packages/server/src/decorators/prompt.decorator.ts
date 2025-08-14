import { SetMetadata, Type } from '@nestjs/common';
import { MCP_PROMPT_METADATA_KEY } from './constants';
import { z } from 'zod';

export interface PromptMetadata {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny | Type<any>;
  template?: string;
  examples?: string[];
}

export interface PromptOptions {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny | Type<any>;
  template?: string;
  examples?: string[];
}

/**
 * Decorator that marks a controller method as an MCP prompt.
 * @param options - The options for the decorator
 * @param options.name - The name of the prompt
 * @param options.description - The description of the prompt
 * @param options.parameters - The parameters of the prompt (Zod schema or DTO class)
 * @param options.template - The template string for the prompt
 * @param options.examples - Example usages of the prompt
 * @returns The decorator
 */
export const Prompt = (options: PromptOptions) => {
  return SetMetadata(MCP_PROMPT_METADATA_KEY, options);
};
