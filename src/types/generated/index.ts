/**
 * Generated Types Index
 *
 * Re-exports types generated from the Docling Serve OpenAPI specification.
 * Use the `OpenAPI` namespace to access raw generated types.
 *
 * @example
 * ```typescript
 * import { OpenAPI } from 'docling-sdk';
 *
 * // Access via namespace
 * type ConvertEndpoint = OpenAPI.paths['/v1/convert/source'];
 * type TaskStatus = OpenAPI.components['schemas']['TaskStatus'];
 * ```
 */

import type {
  paths as GeneratedPaths,
  components as GeneratedComponents,
  operations as GeneratedOperations,
} from "./api";

/**
 * OpenAPI namespace containing all generated types from the Docling Serve API spec.
 * Use this namespace to access endpoint definitions, schemas, and operations.
 */
export namespace OpenAPI {
  /** OpenAPI path definitions - all API endpoints */
  export type paths = GeneratedPaths;

  /** OpenAPI component schemas - all shared type definitions */
  export type components = GeneratedComponents;

  /** OpenAPI operations - individual endpoint operations */
  export type operations = GeneratedOperations;

  /** Helper type for accessing schemas directly */
  export type Schemas = GeneratedComponents["schemas"];
}

// Also export the raw types for direct import if preferred
export type { GeneratedPaths as paths };
export type { GeneratedComponents as components };
export type { GeneratedOperations as operations };
