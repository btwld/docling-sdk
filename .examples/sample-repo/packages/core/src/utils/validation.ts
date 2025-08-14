/**
 * Validation utilities for MCP
 */

import { z } from 'zod';
import { ValidationError } from './error';

/**
 * Validate data against a Zod schema
 */
export function validateSchema<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Schema validation failed', error.errors);
    }
    throw error;
  }
}

/**
 * Safely validate data against a Zod schema
 */
export function safeValidateSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; error: ValidationError } {
  try {
    const result = validateSchema(schema, data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { success: false, error };
    }
    return {
      success: false,
      error: new ValidationError('Unexpected validation error'),
    };
  }
}
