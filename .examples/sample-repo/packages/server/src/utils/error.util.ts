import { JsonRpcErrorCode } from '../types/json-rpc.types';

/**
 * Custom error codes for MCP
 */
export enum ErrorCode {
  // Standard JSON-RPC error codes
  PARSE_ERROR = JsonRpcErrorCode.PARSE_ERROR,
  INVALID_REQUEST = JsonRpcErrorCode.INVALID_REQUEST,
  METHOD_NOT_FOUND = JsonRpcErrorCode.METHOD_NOT_FOUND,
  INVALID_PARAMS = JsonRpcErrorCode.INVALID_PARAMS,
  INTERNAL_ERROR = JsonRpcErrorCode.INTERNAL_ERROR,

  // Custom MCP error codes
  TOOL_NOT_FOUND = JsonRpcErrorCode.TOOL_NOT_FOUND,
  TOOL_EXECUTION_ERROR = JsonRpcErrorCode.TOOL_EXECUTION_ERROR,
  RESOURCE_NOT_FOUND = JsonRpcErrorCode.RESOURCE_NOT_FOUND,
  PROMPT_NOT_FOUND = JsonRpcErrorCode.PROMPT_NOT_FOUND,
  UNAUTHORIZED = JsonRpcErrorCode.UNAUTHORIZED,
  RATE_LIMITED = JsonRpcErrorCode.RATE_LIMITED,
  SESSION_EXPIRED = JsonRpcErrorCode.SESSION_EXPIRED,
}

/**
 * Create a custom error with additional properties
 * @param message Error message
 * @param code Error code
 * @param data Additional error data
 * @returns Custom error object
 */
export function createError(
  message: string,
  code: ErrorCode = ErrorCode.INTERNAL_ERROR,
  data?: Record<string, unknown>,
): Error & { code: ErrorCode; data?: Record<string, unknown> } {
  const error = new Error(message) as Error & {
    code: ErrorCode;
    data?: Record<string, unknown>;
  };
  error.code = code;
  if (data) {
    error.data = data;
  }
  return error;
}
