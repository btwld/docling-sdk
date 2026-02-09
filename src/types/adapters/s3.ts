/**
 * S3 Configuration Adapters
 *
 * Maps user-friendly S3Config to OpenAPI-compatible S3Source/S3Target formats.
 * These adapters allow users to provide simpler AWS-style configuration while
 * the SDK handles the transformation to the Docling Serve API format.
 */

import type { S3Source, S3Target } from "../api";
import type { S3Config } from "../client";

/**
 * Map user-friendly S3Config to API S3Source format
 *
 * @param config - User-friendly S3 configuration
 * @returns S3Source in OpenAPI format
 * @throws Error if required credentials are missing
 *
 * @example
 * ```typescript
 * const source = toOpenApiS3Source({
 *   bucket: 'my-bucket',
 *   key: 'documents/file.pdf',
 *   region: 'us-west-2',
 *   access_key_id: 'AKIAIOSFODNN7EXAMPLE',
 *   secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
 * });
 * ```
 */
export function toOpenApiS3Source(config: S3Config): S3Source {
  const region = config.region || getEnvVar("AWS_REGION") || "us-east-1";
  const endpoint = config.endpoint || `s3.${region}.amazonaws.com`;
  const access_key = config.access_key_id || getEnvVar("AWS_ACCESS_KEY_ID");
  const secret_key = config.secret_access_key || getEnvVar("AWS_SECRET_ACCESS_KEY");

  if (!access_key || !secret_key) {
    throw new Error(
      "AWS credentials are required. Provide access_key_id and secret_access_key or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables."
    );
  }

  if (!config.key) {
    throw new Error("S3 key is required for source operations.");
  }

  return {
    kind: "s3",
    endpoint,
    verify_ssl: config.verify_ssl ?? true,
    access_key,
    secret_key,
    bucket: config.bucket,
    key_prefix: config.key,
  };
}

/**
 * Map user-friendly S3Config to API S3Target format
 *
 * @param config - User-friendly S3 configuration
 * @returns S3Target in OpenAPI format
 * @throws Error if required credentials are missing
 *
 * @example
 * ```typescript
 * const target = toOpenApiS3Target({
 *   bucket: 'output-bucket',
 *   key: 'converted/',
 *   region: 'us-west-2'
 * });
 * ```
 */
export function toOpenApiS3Target(config: S3Config): S3Target {
  const region = config.region || getEnvVar("AWS_REGION") || "us-east-1";
  const endpoint = config.endpoint || `s3.${region}.amazonaws.com`;
  const access_key = config.access_key_id || getEnvVar("AWS_ACCESS_KEY_ID");
  const secret_key = config.secret_access_key || getEnvVar("AWS_SECRET_ACCESS_KEY");

  if (!access_key || !secret_key) {
    throw new Error(
      "AWS credentials are required. Provide access_key_id and secret_access_key or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables."
    );
  }

  return {
    kind: "s3",
    endpoint,
    verify_ssl: config.verify_ssl ?? true,
    access_key,
    secret_key,
    bucket: config.bucket,
    key_prefix: config.key || "",
  };
}

/**
 * Check if an S3 config object uses user-friendly field names
 * (as opposed to the raw OpenAPI format)
 *
 * @param config - Object to check
 * @returns true if config uses user-friendly field names
 */
export function isUserFriendlyS3Config(config: Record<string, unknown>): boolean {
  return (
    config.kind === "s3" &&
    ("region" in config ||
      "access_key_id" in config ||
      "secret_access_key" in config ||
      !("endpoint" in config))
  );
}

/**
 * Helper to safely get environment variables across runtimes
 */
function getEnvVar(name: string): string | undefined {
  // Check for process.env (Node.js, Bun)
  if (typeof process !== "undefined" && process.env) {
    return process.env[name];
  }
  // Check for Deno.env
  if (typeof Deno !== "undefined" && Deno.env) {
    try {
      return Deno.env.get(name);
    } catch {
      // Deno may throw if permission not granted
      return undefined;
    }
  }
  return undefined;
}

// Declare Deno for TypeScript
declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};
