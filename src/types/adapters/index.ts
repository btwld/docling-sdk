/**
 * Type Adapters
 *
 * Functions that transform between user-friendly SDK types and
 * OpenAPI-generated types for the Docling Serve API.
 */

export {
  toOpenApiS3Source,
  toOpenApiS3Target,
  isUserFriendlyS3Config,
} from "./s3";
