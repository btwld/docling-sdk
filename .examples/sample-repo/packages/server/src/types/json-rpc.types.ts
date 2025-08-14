/**
 * Type definitions for JSON-RPC 2.0 messages
 */

/**
 * JSON-RPC 2.0 version string
 */
export const JSON_RPC_VERSION = '2.0';

/**
 * JSON-RPC 2.0 ID type
 */
export type JsonRpcId = string | number | null;

/**
 * JSON-RPC 2.0 params type
 */
export type JsonRpcParams =
  | Record<string, unknown>
  | Array<unknown>
  | undefined;

/**
 * JSON-RPC 2.0 base message interface
 */
export interface JsonRpcMessage {
  jsonrpc: typeof JSON_RPC_VERSION;
}

/**
 * JSON-RPC 2.0 request interface
 */
export interface JsonRpcRequest extends JsonRpcMessage {
  id: JsonRpcId;
  method: string;
  params?: JsonRpcParams;
}

/**
 * JSON-RPC 2.0 notification interface (request without ID)
 */
export interface JsonRpcNotification extends JsonRpcMessage {
  method: string;
  params?: JsonRpcParams;
}

/**
 * JSON-RPC 2.0 error object interface
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * JSON-RPC 2.0 success response interface
 */
export interface JsonRpcSuccessResponse<T = unknown> extends JsonRpcMessage {
  id: JsonRpcId;
  result: T;
}

/**
 * JSON-RPC 2.0 error response interface
 */
export interface JsonRpcErrorResponse extends JsonRpcMessage {
  id: JsonRpcId;
  error: JsonRpcError;
}

/**
 * JSON-RPC 2.0 response type (success or error)
 */
export type JsonRpcResponse<T = unknown> =
  | JsonRpcSuccessResponse<T>
  | JsonRpcErrorResponse;

/**
 * JSON-RPC 2.0 batch request type
 */
export type JsonRpcBatchRequest = Array<JsonRpcRequest | JsonRpcNotification>;

/**
 * JSON-RPC 2.0 batch response type
 */
export type JsonRpcBatchResponse = Array<JsonRpcResponse>;

/**
 * Type guard to check if an object is a JSON-RPC request
 */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jsonrpc' in value &&
    (value as JsonRpcRequest).jsonrpc === JSON_RPC_VERSION &&
    'method' in value &&
    typeof (value as JsonRpcRequest).method === 'string' &&
    'id' in value
  );
}

/**
 * Type guard to check if an object is a JSON-RPC notification
 */
export function isJsonRpcNotification(
  value: unknown,
): value is JsonRpcNotification {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jsonrpc' in value &&
    (value as JsonRpcNotification).jsonrpc === JSON_RPC_VERSION &&
    'method' in value &&
    typeof (value as JsonRpcNotification).method === 'string' &&
    !('id' in value)
  );
}

/**
 * Type guard to check if an object is a JSON-RPC success response
 */
export function isJsonRpcSuccessResponse<T = unknown>(
  value: unknown,
): value is JsonRpcSuccessResponse<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jsonrpc' in value &&
    (value as JsonRpcSuccessResponse).jsonrpc === JSON_RPC_VERSION &&
    'id' in value &&
    'result' in value &&
    !('error' in value)
  );
}

/**
 * Type guard to check if an object is a JSON-RPC error response
 */
export function isJsonRpcErrorResponse(
  value: unknown,
): value is JsonRpcErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'jsonrpc' in value &&
    (value as JsonRpcErrorResponse).jsonrpc === JSON_RPC_VERSION &&
    'id' in value &&
    'error' in value &&
    !('result' in value)
  );
}

/**
 * Type guard to check if an object is a JSON-RPC response (success or error)
 */
export function isJsonRpcResponse<T = unknown>(
  value: unknown,
): value is JsonRpcResponse<T> {
  return isJsonRpcSuccessResponse<T>(value) || isJsonRpcErrorResponse(value);
}

/**
 * Type guard to check if an object is a JSON-RPC batch request
 */
export function isJsonRpcBatchRequest(
  value: unknown,
): value is JsonRpcBatchRequest {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isJsonRpcRequest(item) || isJsonRpcNotification(item))
  );
}

/**
 * Type guard to check if an object is a JSON-RPC batch response
 */
export function isJsonRpcBatchResponse(
  value: unknown,
): value is JsonRpcBatchResponse {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isJsonRpcResponse(item))
  );
}

/**
 * Standard JSON-RPC 2.0 error codes
 */
export enum JsonRpcErrorCode {
  // Standard JSON-RPC 2.0 error codes
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,

  // Server-specific error codes
  SERVER_ERROR_START = -32000,
  SERVER_ERROR_END = -32099,

  // MCP-specific error codes
  TOOL_NOT_FOUND = -32000,
  TOOL_EXECUTION_ERROR = -32001,
  RESOURCE_NOT_FOUND = -32002,
  PROMPT_NOT_FOUND = -32003,
  UNAUTHORIZED = -32004,
  RATE_LIMITED = -32005,
  SESSION_EXPIRED = -32006,
  TRANSPORT_ERROR = -32007,
  CAPABILITY_NOT_SUPPORTED = -32008,
}

/**
 * Create a JSON-RPC request object
 * @param method Method name
 * @param params Method parameters
 * @param id Request ID (optional)
 * @returns JSON-RPC request object
 */
export function createJsonRpcRequest<
  T extends JsonRpcParams = Record<string, unknown>,
>(method: string, params?: T, id?: JsonRpcId): JsonRpcRequest {
  const request: JsonRpcRequest = {
    jsonrpc: JSON_RPC_VERSION,
    method,
    id: id ?? null,
  };

  if (params !== undefined) {
    request.params = params;
  }

  return request;
}

/**
 * Create a JSON-RPC notification object (request without an ID)
 * @param method Method name
 * @param params Method parameters
 * @returns JSON-RPC notification object
 */
export function createJsonRpcNotification<
  T extends JsonRpcParams = Record<string, unknown>,
>(method: string, params?: T): JsonRpcNotification {
  const notification: JsonRpcNotification = {
    jsonrpc: JSON_RPC_VERSION,
    method,
  };

  if (params !== undefined) {
    notification.params = params;
  }

  return notification;
}

/**
 * Create a JSON-RPC success response object
 * @param id Request ID
 * @param result Result data
 * @returns JSON-RPC success response object
 */
export function createJsonRpcSuccessResponse<T = unknown>(
  id: JsonRpcId,
  result: T,
): JsonRpcSuccessResponse<T> {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}

/**
 * Create a JSON-RPC error object
 * @param code Error code
 * @param message Error message
 * @param data Additional error data
 * @returns JSON-RPC error object
 */
export function createJsonRpcError(
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  const error: JsonRpcError = {
    code,
    message,
  };

  if (data !== undefined) {
    error.data = data;
  }

  return error;
}

/**
 * Create a JSON-RPC error response object
 * @param id Request ID
 * @param error JSON-RPC error object or error code
 * @param message Error message (if error code is provided)
 * @param data Additional error data (if error code is provided)
 * @returns JSON-RPC error response object
 */
export function createJsonRpcErrorResponse(
  id: JsonRpcId,
  errorOrCode: JsonRpcError | number,
  message?: string,
  data?: unknown,
): JsonRpcErrorResponse {
  const error =
    typeof errorOrCode === 'object'
      ? errorOrCode
      : createJsonRpcError(errorOrCode, message || 'Unknown error', data);

  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error,
  };
}

/**
 * Extract the ID from a JSON-RPC request
 * @param request JSON-RPC request or unknown object
 * @returns Request ID or null if not found
 */
export function extractJsonRpcId(request: unknown): JsonRpcId {
  if (isJsonRpcRequest(request)) {
    return request.id;
  }

  if (
    Array.isArray(request) &&
    request.length > 0 &&
    isJsonRpcRequest(request[0])
  ) {
    return request[0].id;
  }

  return null;
}

/**
 * Create a JSON-RPC parse error response
 * @param id Request ID
 * @param message Error message
 * @returns JSON-RPC error response object
 */
export function createJsonRpcParseErrorResponse(
  id: JsonRpcId = null,
  message = 'Parse error',
): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse(id, JsonRpcErrorCode.PARSE_ERROR, message);
}

/**
 * Create a JSON-RPC invalid request error response
 * @param id Request ID
 * @param message Error message
 * @returns JSON-RPC error response object
 */
export function createJsonRpcInvalidRequestResponse(
  id: JsonRpcId = null,
  message = 'Invalid request',
): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse(
    id,
    JsonRpcErrorCode.INVALID_REQUEST,
    message,
  );
}

/**
 * Create a JSON-RPC method not found error response
 * @param id Request ID
 * @param method Method name
 * @returns JSON-RPC error response object
 */
export function createJsonRpcMethodNotFoundResponse(
  id: JsonRpcId,
  method?: string,
): JsonRpcErrorResponse {
  const message = method ? `Method not found: ${method}` : 'Method not found';

  return createJsonRpcErrorResponse(
    id,
    JsonRpcErrorCode.METHOD_NOT_FOUND,
    message,
  );
}

/**
 * Create a JSON-RPC invalid params error response
 * @param id Request ID
 * @param message Error message
 * @param data Additional error data
 * @returns JSON-RPC error response object
 */
export function createJsonRpcInvalidParamsResponse(
  id: JsonRpcId,
  message = 'Invalid params',
  data?: unknown,
): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse(
    id,
    JsonRpcErrorCode.INVALID_PARAMS,
    message,
    data,
  );
}

/**
 * Create a JSON-RPC internal error response
 * @param id Request ID
 * @param message Error message
 * @param data Additional error data
 * @returns JSON-RPC error response object
 */
export function createJsonRpcInternalErrorResponse(
  id: JsonRpcId,
  message = 'Internal error',
  data?: unknown,
): JsonRpcErrorResponse {
  return createJsonRpcErrorResponse(
    id,
    JsonRpcErrorCode.INTERNAL_ERROR,
    message,
    data,
  );
}

/**
 * Handle an error and convert it to a JSON-RPC error response
 * @param id Request ID
 * @param error Error object
 * @returns JSON-RPC error response
 */
export function handleJsonRpcError(
  id: JsonRpcId,
  error: unknown,
): JsonRpcErrorResponse {
  if (error instanceof Error) {
    const errorMessage = error.message;
    const errorData: Record<string, unknown> = {
      name: error.name,
    };

    if (process.env.NODE_ENV !== 'production' && error.stack) {
      errorData.stack = error.stack;
    }

    if (
      errorMessage.includes('not found') ||
      errorMessage.includes('unknown')
    ) {
      return createJsonRpcErrorResponse(
        id,
        JsonRpcErrorCode.METHOD_NOT_FOUND,
        errorMessage,
        errorData,
      );
    }

    if (
      errorMessage.includes('invalid') ||
      errorMessage.includes('validation')
    ) {
      return createJsonRpcErrorResponse(
        id,
        JsonRpcErrorCode.INVALID_PARAMS,
        errorMessage,
        errorData,
      );
    }

    if (
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('permission')
    ) {
      return createJsonRpcErrorResponse(
        id,
        JsonRpcErrorCode.UNAUTHORIZED,
        errorMessage,
        errorData,
      );
    }

    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests')
    ) {
      return createJsonRpcErrorResponse(
        id,
        JsonRpcErrorCode.RATE_LIMITED,
        errorMessage,
        errorData,
      );
    }

    if (
      errorMessage.includes('session expired') ||
      errorMessage.includes('session invalid')
    ) {
      return createJsonRpcErrorResponse(
        id,
        JsonRpcErrorCode.SESSION_EXPIRED,
        errorMessage,
        errorData,
      );
    }

    return createJsonRpcErrorResponse(
      id,
      JsonRpcErrorCode.INTERNAL_ERROR,
      errorMessage,
      errorData,
    );
  }

  return createJsonRpcErrorResponse(
    id,
    JsonRpcErrorCode.INTERNAL_ERROR,
    'Internal server error',
    { error: String(error) },
  );
}

/**
 * Parse a JSON-RPC request from a string
 * @param jsonString JSON string to parse
 * @returns Parsed JSON-RPC request or error response
 */
export function parseJsonRpcRequest(
  jsonString: string,
): JsonRpcRequest | JsonRpcBatchRequest | JsonRpcErrorResponse {
  try {
    const parsed = JSON.parse(jsonString);

    if (isJsonRpcRequest(parsed) || isJsonRpcBatchRequest(parsed)) {
      return parsed;
    }

    return createJsonRpcInvalidRequestResponse();
  } catch (error) {
    return createJsonRpcParseErrorResponse();
  }
}

/**
 * Check if a request is an initialize request
 * @param request Request to check
 * @returns True if the request is an initialize request
 */
export function isInitializeRequest(request: unknown): boolean {
  if (isJsonRpcBatchRequest(request)) {
    return request.some(
      (item) => isJsonRpcRequest(item) && item.method === 'initialize',
    );
  }

  return isJsonRpcRequest(request) && request.method === 'initialize';
}
