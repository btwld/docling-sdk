import { Injectable } from '@nestjs/common';
import { ErrorCode as SDKErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  JsonRpcId,
  JsonRpcResponse,
  JsonRpcErrorCode,
} from '../types/json-rpc.types';
import { McpError } from '../types/common';
import { ErrorHandler } from '../utils/error-handler.util';

/**
 * Service for handling MCP errors
 */
@Injectable()
export class McpErrorHandlerService {
  private readonly errorHandler: ErrorHandler;

  constructor() {
    this.errorHandler = new ErrorHandler(McpErrorHandlerService.name);
  }

  /**
   * Creates an MCP error
   *
   * @param code Error code
   * @param message Error message
   * @param data Additional error data
   * @returns MCP error
   */
  createError(
    code: JsonRpcErrorCode | SDKErrorCode,
    message: string,
    data?: unknown,
  ): McpError {
    return this.errorHandler.createError(
      code as JsonRpcErrorCode,
      message,
      data,
    );
  }

  /**
   * Handles an error and returns a JSON-RPC error response
   *
   * @param id Request ID
   * @param error Error object
   * @returns JSON-RPC error response
   */
  handleError(id: JsonRpcId, error: unknown): JsonRpcResponse {
    return this.errorHandler.handleError(id, error);
  }

  /**
   * Maps SDK error codes to JSON-RPC error codes
   * @param sdkErrorCode SDK error code
   * @returns JSON-RPC error code
   */
  mapSdkErrorCode(sdkErrorCode: SDKErrorCode): JsonRpcErrorCode {
    switch (sdkErrorCode) {
      case SDKErrorCode.MethodNotFound:
        return JsonRpcErrorCode.METHOD_NOT_FOUND;
      case SDKErrorCode.InvalidParams:
        return JsonRpcErrorCode.INVALID_PARAMS;
      case SDKErrorCode.InternalError:
        return JsonRpcErrorCode.INTERNAL_ERROR;
      case SDKErrorCode.ParseError:
        return JsonRpcErrorCode.PARSE_ERROR;
      case SDKErrorCode.InvalidRequest:
        return JsonRpcErrorCode.INVALID_REQUEST;
      default:
        return JsonRpcErrorCode.INTERNAL_ERROR;
    }
  }
}
