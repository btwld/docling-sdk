/**
 * Cross-runtime binary data utilities
 * Provides Uint8Array-based operations that work in all environments
 * Replaces Node.js Buffer with standard Uint8Array
 */

/**
 * Binary data type - cross-runtime compatible
 */
export type BinaryData = Uint8Array;

/**
 * Create a new Uint8Array from various input types
 */
export function createBinary(
  input: string | ArrayBuffer | Uint8Array | number[] | number,
  encoding?: "utf-8" | "base64" | "hex"
): Uint8Array {
  if (typeof input === "number") {
    return new Uint8Array(input);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  if (Array.isArray(input)) {
    return new Uint8Array(input);
  }

  // String input - handle encoding
  if (typeof input === "string") {
    if (encoding === "base64") {
      return base64ToUint8Array(input);
    }
    if (encoding === "hex") {
      return hexToUint8Array(input);
    }
    // Default to UTF-8
    return stringToUint8Array(input);
  }

  throw new Error(`Unsupported input type: ${typeof input}`);
}

/**
 * Convert Uint8Array to string
 */
export function binaryToString(
  data: Uint8Array,
  encoding: "utf-8" | "base64" | "hex" = "utf-8"
): string {
  if (encoding === "base64") {
    return uint8ArrayToBase64(data);
  }
  if (encoding === "hex") {
    return uint8ArrayToHex(data);
  }
  return uint8ArrayToString(data);
}

/**
 * Convert string to Uint8Array (UTF-8)
 */
export function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Convert Uint8Array to string (UTF-8)
 */
export function uint8ArrayToString(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  // Handle browser and server environments
  if (typeof globalThis.atob === "function") {
    const binaryString = globalThis.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  // Fallback for environments without atob (shouldn't happen in modern runtimes)
  throw new Error("Base64 decoding not supported in this environment");
}

/**
 * Convert Uint8Array to base64 string
 */
export function uint8ArrayToBase64(data: Uint8Array): string {
  // Handle browser and server environments
  if (typeof globalThis.btoa === "function") {
    const binaryString = Array.from(data)
      .map((byte) => String.fromCharCode(byte))
      .join("");
    return globalThis.btoa(binaryString);
  }

  // Fallback for environments without btoa (shouldn't happen in modern runtimes)
  throw new Error("Base64 encoding not supported in this environment");
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^0x/i, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Hex string must have even length");
  }

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function uint8ArrayToHex(data: Uint8Array): string {
  return Array.from(data)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatBinary(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

/**
 * Slice a Uint8Array (immutable, returns new array)
 */
export function sliceBinary(data: Uint8Array, start?: number, end?: number): Uint8Array {
  return data.slice(start, end);
}

/**
 * Compare two Uint8Arrays for equality
 */
export function equalsBinary(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Create a view of a Uint8Array without copying
 */
export function viewBinary(data: Uint8Array, byteOffset: number, byteLength?: number): Uint8Array {
  return new Uint8Array(
    data.buffer,
    data.byteOffset + byteOffset,
    byteLength ?? data.length - byteOffset
  );
}

/**
 * Check if value is a Uint8Array
 */
export function isBinary(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/**
 * Check if value is a Node.js Buffer (for interop)
 */
export function isNodeBuffer(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).constructor?.name === "Buffer"
  );
}

/**
 * Convert Node.js Buffer to Uint8Array
 * Provides zero-copy conversion when possible
 */
export function bufferToUint8Array(buffer: unknown): Uint8Array {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }

  // Handle Node.js Buffer
  if (isNodeBuffer(buffer)) {
    const nodeBuffer = buffer as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    return new Uint8Array(nodeBuffer.buffer, nodeBuffer.byteOffset, nodeBuffer.byteLength);
  }

  throw new Error("Expected Buffer or Uint8Array");
}

/**
 * Create a Blob from Uint8Array (for form uploads)
 */
export function binaryToBlob(data: Uint8Array, type = "application/octet-stream"): Blob {
  return new Blob([data], { type });
}

/**
 * Create Uint8Array from Blob
 */
export async function blobToBinary(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Create Uint8Array from ReadableStream
 */
export async function streamToBinary(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return concatBinary(...chunks);
}

/**
 * Create ReadableStream from Uint8Array
 */
export function binaryToStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

/**
 * Generate a random UUID (cross-runtime)
 */
export function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  // Fallback implementation using crypto.getRandomValues
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);

    // Set version (4) and variant (10) bits
    // biome-ignore lint/style/noNonNullAssertion: bytes[6] is guaranteed to exist in a 16-byte array
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    // biome-ignore lint/style/noNonNullAssertion: bytes[8] is guaranteed to exist in a 16-byte array
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;

    const hex = uint8ArrayToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last resort fallback using Math.random (not cryptographically secure)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
