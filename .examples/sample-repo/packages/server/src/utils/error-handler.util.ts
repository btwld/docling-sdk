/**
 * Error handling utilities
 */
import { Logger } from '@nestjs/common';
import {
  JsonRpcId,
  JsonRpcErrorCode,
  JsonRpcResponse,
  createJsonRpcErrorResponse,
} from '../types/json-rpc.types';
import { McpError } from '../types/common';

/**
 * Standard error handler for MCP errors
 */
export class ErrorHandler {
  private readonly logger: Logger;

  /**
   * Create a new error handler
   * @param loggerName Name for the logger
   */
  constructor(loggerName: string) {
    this.logger = new Logger(loggerName);
  }

  /**
   * Handle an error and convert it to a JSON-RPC error response
   * @param id Request ID
   * @param error Error to handle
   * @returns JSON-RPC error response
   */
  handleError(id: JsonRpcId, error: unknown): JsonRpcResponse {
    if (error instanceof McpError) {
      this.logger.error(`MCP Error (${error.code}): ${error.message}`);
      return createJsonRpcErrorResponse(
        id,
        error.code,
        error.message,
        error.data,
      );
    }

    if (error instanceof Error) {
      this.logger.error(`Error: ${error.message}`, error.stack);
      return createJsonRpcErrorResponse(
        id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        error.message,
        error.stack,
      );
    }

    const errorMessage = String(error);
    this.logger.error(`Unknown error: ${errorMessage}`);
    return createJsonRpcErrorResponse(
      id,
      JsonRpcErrorCode.INTERNAL_ERROR,
      `Unknown error: ${errorMessage}`,
    );
  }

  /**
   * Create an McpError with the given code and message
   * @param code Error code
   * @param message Error message
   * @param data Additional error data
   * @returns McpError instance
   */
  createError(
    code: JsonRpcErrorCode,
    message: string,
    data?: unknown,
  ): McpError {
    return new McpError(code, message, data);
  }
}
