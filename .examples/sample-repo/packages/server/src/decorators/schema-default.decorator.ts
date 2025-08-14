import 'reflect-metadata';
import { MCP_SCHEMA_DEFAULT_METADATA_KEY } from './constants';

/**
 * Decorator that defines a default value for a property.
 * This will be used when converting to Zod schema.
 *
 * @param value - The default value to use
 * @returns PropertyDecorator
 */
export function SchemaDefault(value: any): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    Reflect.defineMetadata(
      MCP_SCHEMA_DEFAULT_METADATA_KEY,
      value,
      target,
      propertyKey,
    );
  };
}

/**
 * Get the default value for a property
 * @param target - Target object
 * @param propertyKey - Property name
 * @returns The default value or undefined
 */
export function getSchemaDefault(
  target: object,
  propertyKey: string | symbol,
): any {
  return Reflect.getMetadata(
    MCP_SCHEMA_DEFAULT_METADATA_KEY,
    target,
    propertyKey,
  );
}

/**
 * Get all properties with default values on a target object
 * @param target - Target object or constructor
 * @returns Map of property names to default values
 */
export function getAllSchemaDefaults(target: object): Map<string, any> {
  const defaults = new Map<string, any>();
  const prototype =
    target instanceof Function
      ? target.prototype
      : Object.getPrototypeOf(target);

  if (!prototype) return defaults;

  const propertyNames = Reflect.getMetadataKeys(prototype)
    .filter((key) => typeof key === 'string')
    .filter((key) =>
      Reflect.hasMetadata(MCP_SCHEMA_DEFAULT_METADATA_KEY, prototype, key),
    );

  for (const propertyName of propertyNames) {
    if (typeof propertyName === 'string') {
      defaults.set(
        propertyName,
        Reflect.getMetadata(
          MCP_SCHEMA_DEFAULT_METADATA_KEY,
          prototype,
          propertyName,
        ),
      );
    }
  }

  return defaults;
}
