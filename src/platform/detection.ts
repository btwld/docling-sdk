/**
 * Runtime detection utilities for cross-runtime compatibility
 * Detects whether code is running in Node.js, Bun, Deno, or browser
 */

/**
 * Supported runtime environments
 */
export type RuntimeEnvironment = "node" | "bun" | "deno" | "browser" | "unknown";

/**
 * Check if running in Node.js
 */
export function isNode(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.process !== "undefined" &&
    globalThis.process.versions?.node !== undefined &&
    !isBun()
  );
}

/**
 * Check if running in Bun
 */
export function isBun(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.Bun !== "undefined"
  );
}

/**
 * Check if running in Deno
 */
export function isDeno(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.Deno !== "undefined"
  );
}

/**
 * Check if running in a browser environment
 */
export function isBrowser(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.window !== "undefined" &&
    typeof globalThis.document !== "undefined" &&
    !isNode() &&
    !isBun() &&
    !isDeno()
  );
}

/**
 * Check if running in a server-side environment (Node.js, Bun, or Deno)
 */
export function isServer(): boolean {
  return isNode() || isBun() || isDeno();
}

/**
 * Check if the WebSocket API is natively available
 */
export function hasNativeWebSocket(): boolean {
  return typeof globalThis.WebSocket !== "undefined";
}

/**
 * Check if the Fetch API is natively available
 */
export function hasNativeFetch(): boolean {
  return typeof globalThis.fetch !== "undefined";
}

/**
 * Check if Web Streams API is available
 */
export function hasWebStreams(): boolean {
  return (
    typeof globalThis.ReadableStream !== "undefined" &&
    typeof globalThis.WritableStream !== "undefined"
  );
}

/**
 * Check if AbortController is available
 */
export function hasAbortController(): boolean {
  return typeof globalThis.AbortController !== "undefined";
}

/**
 * Check if FormData is available
 */
export function hasFormData(): boolean {
  return typeof globalThis.FormData !== "undefined";
}

/**
 * Check if Blob is available
 */
export function hasBlob(): boolean {
  return typeof globalThis.Blob !== "undefined";
}

/**
 * Check if File is available
 */
export function hasFile(): boolean {
  return typeof globalThis.File !== "undefined";
}

/**
 * Check if crypto.randomUUID is available
 */
export function hasRandomUUID(): boolean {
  return typeof globalThis.crypto?.randomUUID === "function";
}

/**
 * Detect the current runtime environment
 */
export function detectRuntime(): RuntimeEnvironment {
  if (isBun()) return "bun";
  if (isDeno()) return "deno";
  if (isNode()) return "node";
  if (isBrowser()) return "browser";
  return "unknown";
}

/**
 * Get current runtime information
 */
export function getRuntimeInfo(): {
  runtime: RuntimeEnvironment;
  version?: string;
  features: {
    nativeWebSocket: boolean;
    nativeFetch: boolean;
    webStreams: boolean;
    abortController: boolean;
    formData: boolean;
    blob: boolean;
    file: boolean;
    randomUUID: boolean;
  };
} {
  const runtime = detectRuntime();
  let version: string | undefined;

  if (runtime === "node" && globalThis.process?.versions?.node) {
    version = globalThis.process.versions.node;
  } else if (runtime === "bun" && (globalThis as Record<string, unknown>).Bun) {
    version = ((globalThis as Record<string, unknown>).Bun as { version?: string })?.version;
  } else if (runtime === "deno" && (globalThis as Record<string, unknown>).Deno) {
    version = ((globalThis as Record<string, unknown>).Deno as { version?: { deno?: string } })?.version?.deno;
  }

  return {
    runtime,
    version,
    features: {
      nativeWebSocket: hasNativeWebSocket(),
      nativeFetch: hasNativeFetch(),
      webStreams: hasWebStreams(),
      abortController: hasAbortController(),
      formData: hasFormData(),
      blob: hasBlob(),
      file: hasFile(),
      randomUUID: hasRandomUUID(),
    },
  };
}

// Augment globalThis types for TypeScript
declare global {
  var Bun: { version?: string } | undefined;
  var Deno: { version?: { deno?: string } } | undefined;
}
