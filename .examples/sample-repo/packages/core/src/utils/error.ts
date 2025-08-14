/**
 * Error utilities for MCP
 */

import { JsonRpcErrorCode } from '../types/json-rpc';

/**
 * Error class for MCP-related errors
 */
export class McpError extends Error {
  constructor(
    public readonly code: JsonRpcErrorCode,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/**
 * Error class for transport-related errors
 */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * Error class for validation-related errors
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
