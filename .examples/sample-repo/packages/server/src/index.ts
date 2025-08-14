// Export decorators
export { Tool } from './decorators/tool.decorator';
export type { ToolOptions, ToolMetadata } from './decorators/tool.decorator';
export { Resource } from './decorators/resource.decorator';
export type {
  ResourceOptions,
  ResourceMetadata,
} from './decorators/resource.decorator';
export { Prompt } from './decorators/prompt.decorator';
export type {
  PromptOptions,
  PromptMetadata,
} from './decorators/prompt.decorator';

// Export interfaces
export type { McpOptions } from './interfaces/mcp-options.interface';
export type { StreamableHttpTransportOptions } from './interfaces/mcp-options.interface';
export type { SseTransportOptions } from './interfaces/mcp-options.interface';
export type { WebSocketTransportOptions } from './interfaces/mcp-options.interface';
export { AbstractMcpTransportProvider } from './interfaces/mcp-transport.interface';
export type { Context } from './interfaces/mcp-tool.interface';

// Export core types and utilities (bundled with server)
// Note: Selective exports to avoid conflicts with server-specific implementations
export {
  // Core types
  McpTransportType,
  ContentType,
  JsonRpcErrorCode,
  JSON_RPC_VERSION,
} from '@nest-mind/mcp-core';

export type {
  // JSON-RPC types
  JsonRpcError,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcBatchRequest,
  JsonRpcBatchResponse,
  JsonRpcNotification,
  JsonRpcId,
  // Content types
  BaseContent,
  TextContent,
  ImageContent,
  ResourceContent,
  Content,
  // Common types (only those not already exported by server)
  TypedServerCapabilities,
  BaseMetadata,
  PromptArgument,
  // Transport types (only base types, server has its own specific implementations)
  BaseTransportOptions,
  StdioTransportOptions,
  CustomTransportOptions,
} from '@nest-mind/mcp-core';

// Export module
export * from './mcp.module';

// Export services
export * from './services/mcp-discovery.service';
export * from './services/mcp-error-handler.service';
export * from './services/mcp-event-store.service';
export * from './services/mcp-executor.service';
export * from './services/mcp-registry.service';
export * from './services/mcp-validations.service';

// Export transports
export * from './transports/transport.factory';
export * from './transports/base';
export * from './transports/sse.transport';
export * from './transports/streamable-http.transport';
export * from './transports/websocket.transport';
export * from './transports/stdio.transport';

// Export JSON-RPC utilities (keep server-specific ones)
export {
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcSuccessResponse,
  isJsonRpcErrorResponse,
  isJsonRpcBatchRequest,
  isJsonRpcBatchResponse,
  isJsonRpcNotification,
  createJsonRpcRequest,
  createJsonRpcNotification,
  createJsonRpcSuccessResponse,
  createJsonRpcError,
  createJsonRpcErrorResponse,
  extractJsonRpcId,
  createJsonRpcParseErrorResponse,
  createJsonRpcInvalidRequestResponse,
  createJsonRpcMethodNotFoundResponse,
  createJsonRpcInvalidParamsResponse,
  createJsonRpcInternalErrorResponse,
  handleJsonRpcError,
  parseJsonRpcRequest,
  isInitializeRequest,
} from './types/json-rpc.types';
export * from './utils/response.util';
export * from './utils/dto-to-schema.util';
export * from './utils/session-manager.util';
export * from './utils/server-capabilities.util';
