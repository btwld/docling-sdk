import { Type } from '@nestjs/common';
import { z } from 'zod';
import { validationMetadatasToSchemas } from 'class-validator-jsonschema';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { getMetadataStorage } from 'class-validator';
import { getAllSchemaDefaults } from '../decorators/schema-default.decorator';

const schemaCache = new Map<Type<any>, z.ZodType<any>>();

/**
 * Convert a class-validator decorated DTO to a Zod schema
 * @param dtoClass The DTO class to convert
 * @returns A Zod schema equivalent to the DTO
 */
export function dtoToZodSchema<T>(dtoClass: Type<T>): z.ZodType<T> {
  if (schemaCache.has(dtoClass)) {
    return schemaCache.get(dtoClass) as z.ZodType<T>;
  }

  const validatorMetadata = getMetadataStorage();
  const validationMetadata = validatorMetadata.getTargetValidationMetadatas(
    dtoClass,
    dtoClass.name,
    false,
    false,
  );

  const requiredProperties = new Set<string>();
  validationMetadata.forEach((metadata) => {
    if (
      metadata.type === 'isNotEmpty' ||
      metadata.type === 'isNotEmptyObject' ||
      metadata.type === 'isDefined'
    ) {
      requiredProperties.add(metadata.propertyName);
    }
  });

  const errorMap: z.ZodErrorMap = (issue, ctx) => {
    if (
      issue.code === z.ZodIssueCode.invalid_type &&
      issue.received === 'undefined'
    ) {
      if (requiredProperties.has(issue.path[0] as string)) {
        return { message: `Field "${issue.path[0]}" is required` };
      }
    }

    return { message: ctx.defaultError };
  };

  z.setErrorMap(errorMap);

  const schemas = validationMetadatasToSchemas({
    classTransformerMetadataStorage: defaultMetadataStorage,
  });

  const className = dtoClass.name;
  const jsonSchema = schemas[className];

  if (!jsonSchema) {
    throw new Error(`Could not generate JSON schema for DTO: ${className}`);
  }

  if (!jsonSchema.required) {
    jsonSchema.required = [];
  }

  requiredProperties.forEach((prop) => {
    if (!jsonSchema.required.includes(prop)) {
      jsonSchema.required.push(prop);
    }
  });

  const schemaDefaults = getAllSchemaDefaults(dtoClass);

  const propertyDefaults = getPropertyDefaults(dtoClass);

  const mergedDefaults = new Map([...propertyDefaults, ...schemaDefaults]);

  const zodSchema = createZodSchemaFromJsonSchema(jsonSchema, mergedDefaults);

  schemaCache.set(dtoClass, zodSchema);

  return zodSchema as z.ZodType<T>;
}

/**
 * Extract default values from class property initializers
 * @param dtoClass The DTO class to extract defaults from
 * @returns Map of property names to default values
 */
function getPropertyDefaults<T>(dtoClass: Type<T>): Map<string, any> {
  const defaults = new Map<string, any>();
  const instance = new dtoClass();

  const propertyNames = Object.getOwnPropertyNames(instance);

  for (const propertyName of propertyNames) {
    const value = instance[propertyName];
    if (value !== undefined) {
      defaults.set(propertyName, value);
    }
  }

  return defaults;
}

/**
 * Simple converter from JSON Schema to Zod schema
 * Note: This is a basic implementation and doesn't support all JSON Schema features
 */
function createZodSchemaFromJsonSchema(
  jsonSchema: any,
  defaultValues: Map<string, any> = new Map(),
): z.ZodType<any> {
  if (jsonSchema.type === 'object' && jsonSchema.properties) {
    const shape: Record<string, z.ZodType<any>> = {};

    for (const [key, propSchema] of Object.entries<any>(
      jsonSchema.properties,
    )) {
      // Create the initial property type from the schema
      const initialPropType = createZodTypeFromProperty(propSchema);

      // Apply default values if available
      const propTypeWithDefaults = applyDefaultValues(
        initialPropType,
        key,
        propSchema,
        defaultValues,
      );

      shape[key] = propTypeWithDefaults;
    }

    // Create the initial schema from the shape
    const initialSchema = z.object(shape);

    // Apply required/optional properties based on schema definition
    const finalSchema = applyRequiredProperties(jsonSchema, shape);

    return finalSchema;
  }

  return z.any();
}

/**
 * Apply required/optional properties to a schema based on JSON schema definition
 * @param jsonSchema The JSON schema
 * @param shape The shape object containing Zod types
 * @returns A Zod object schema with required/optional properties applied
 */
function applyRequiredProperties(
  jsonSchema: any,
  shape: Record<string, z.ZodType<any>>,
): z.ZodType<any> {
  if (jsonSchema.required && Array.isArray(jsonSchema.required)) {
    // Use the required array from the JSON schema
    const required = new Set(jsonSchema.required);
    const optionalShape: Record<string, z.ZodType<any>> = {};

    for (const [key, propType] of Object.entries(shape)) {
      if (!required.has(key)) {
        optionalShape[key] = propType.optional();
      } else {
        optionalShape[key] = propType;
      }
    }

    return z.object(optionalShape);
  } else {
    // Use isNotEmpty property to determine if a property is required
    const optionalShape: Record<string, z.ZodType<any>> = {};

    for (const [key, propSchema] of Object.entries<any>(
      jsonSchema.properties,
    )) {
      const isRequired = propSchema.isNotEmpty === true;

      if (isRequired) {
        optionalShape[key] = shape[key];
      } else {
        optionalShape[key] = shape[key].optional();
      }
    }

    return z.object(optionalShape);
  }
}

/**
 * Apply default values to a Zod type
 * @param propType The Zod type to apply defaults to
 * @param key The property key
 * @param propSchema The JSON schema for the property
 * @param defaultValues Map of property names to default values
 * @returns The Zod type with defaults applied
 */
function applyDefaultValues(
  propType: z.ZodType<any>,
  key: string,
  propSchema: any,
  defaultValues: Map<string, any>,
): z.ZodType<any> {
  if (defaultValues.has(key)) {
    return propType.default(defaultValues.get(key));
  }

  if (propSchema.default !== undefined) {
    return propType.default(propSchema.default);
  }

  return propType;
}

/**
 * Create an array schema with constraints from JSON schema
 * @param propSchema The JSON schema for the array property
 * @returns A configured Zod array schema
 */
function createArraySchema(propSchema: any): z.ZodArray<any> {
  // Create the item schema
  const itemSchema = propSchema.items
    ? createZodTypeFromProperty(propSchema.items)
    : z.any();

  // Create the array schema
  let arraySchema = z.array(itemSchema);

  // Apply min/max constraints
  if (propSchema.minItems !== undefined) {
    arraySchema = arraySchema.min(propSchema.minItems);
  }

  if (propSchema.maxItems !== undefined) {
    arraySchema = arraySchema.max(propSchema.maxItems);
  }

  return arraySchema;
}

/**
 * Create a number schema with constraints from JSON schema
 * @param propSchema The JSON schema for the number property
 * @returns A configured Zod number schema
 */
function createNumberSchema(propSchema: any): z.ZodNumber {
  let numberSchema = z.number();

  if (propSchema.minimum !== undefined) {
    numberSchema = numberSchema.min(propSchema.minimum);
  }

  if (propSchema.maximum !== undefined) {
    numberSchema = numberSchema.max(propSchema.maximum);
  }

  return numberSchema;
}

/**
 * Create a string schema with constraints from JSON schema
 * @param propSchema The JSON schema for the string property
 * @returns A configured Zod string schema
 */
function createStringSchema(propSchema: any): z.ZodString {
  let stringSchema = z.string();

  if (propSchema.minLength !== undefined) {
    stringSchema = stringSchema.min(propSchema.minLength);
  }

  if (propSchema.maxLength !== undefined) {
    stringSchema = stringSchema.max(propSchema.maxLength);
  }

  if (propSchema.pattern) {
    stringSchema = stringSchema.regex(new RegExp(propSchema.pattern));
  }

  return stringSchema;
}

/**
 * Convert a JSON Schema property to a Zod type
 * @param propSchema The JSON schema for the property
 * @returns The corresponding Zod type
 */
function createZodTypeFromProperty(propSchema: any): z.ZodType<any> {
  switch (propSchema.type) {
    case 'string': {
      // Handle enum type first as it's a different type of schema
      if (propSchema.enum) {
        return z.enum(propSchema.enum);
      }

      // Create and configure string schema
      return createStringSchema(propSchema);
    }
    case 'number':
    case 'integer': {
      return createNumberSchema(propSchema);
    }
    case 'boolean':
      return z.boolean();

    case 'array': {
      return createArraySchema(propSchema);
    }
    case 'object':
      if (propSchema.properties) {
        return createZodSchemaFromJsonSchema(propSchema);
      }
      return z.record(z.any());

    default:
      return z.any();
  }
}
