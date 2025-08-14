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
 * JSON-RPC 2.0 error codes
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
 * JSON-RPC 2.0 success response interface
 */
export interface JsonRpcSuccessResponse extends JsonRpcMessage {
  id: JsonRpcId;
  result: unknown;
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
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * JSON-RPC 2.0 batch request type
 */
export type JsonRpcBatchRequest = JsonRpcRequest[];

/**
 * JSON-RPC 2.0 batch response type
 */
export type JsonRpcBatchResponse = JsonRpcResponse[];
