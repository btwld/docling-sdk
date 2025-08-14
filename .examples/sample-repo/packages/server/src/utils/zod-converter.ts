import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Type } from '@nestjs/common';

/**
 * Check if a value is likely a Zod type
 * This uses a heuristic approach to avoid instanceof issues across different Zod versions
 * @param value The value to check
 * @returns True if the value appears to be a Zod type
 */
export function isZodTypeLike(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    'parse' in value &&
    typeof value.parse === 'function' &&
    'safeParse' in value &&
    typeof value.safeParse === 'function'
  );
}

/**
 * Check if an object is a Zod schema object (ZodRawShape)
 * @param obj The object to check
 * @returns True if the object is a Zod schema object
 */
export function isZodObject(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null) return false;

  const isEmptyObject = Object.keys(obj).length === 0;

  // Check if object is empty or at least one property is a ZodType instance
  return isEmptyObject || Object.values(obj).some(isZodTypeLike);
}

/**
 * Converts a Zod schema or DTO class to a JSON schema
 *
 * @param schema Zod schema or DTO class
 * @returns JSON schema object
 */
export function convertToJsonSchema(
  schema: z.ZodTypeAny | Type<any>,
): Record<string, any> {
  if (schema instanceof z.ZodType) {
    return zodToJsonSchema(schema, {
      $refStrategy: 'none',
      target: 'openApi3',
    });
  }

  if (typeof schema === 'function') {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  throw new Error('Invalid schema type. Expected Zod schema or DTO class.');
}

/**
 * Extracts parameter names from a Zod object schema
 *
 * @param schema Zod object schema
 * @returns Array of parameter names
 */
export function extractParameterNames(schema: z.ZodTypeAny): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }

  return [];
}

/**
 * Validates data against a Zod schema
 *
 * @param schema Zod schema
 * @param data Data to validate
 * @returns Validated and parsed data
 * @throws ZodError if validation fails
 */
export function validateWithZod<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data);
}
