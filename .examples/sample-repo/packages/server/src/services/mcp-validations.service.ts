import { Injectable, Logger, Type } from '@nestjs/common';
import { z } from 'zod';
import { validateWithZod } from '../utils/zod-converter';
import { JsonRpcRequest, JsonRpcErrorCode } from '../types/json-rpc.types';
import { McpError } from '../types/common';

/**
 * Service for validating MCP requests and parameters
 */
@Injectable()
export class McpValidationsService {
  private readonly logger = new Logger(McpValidationsService.name);
  /**
   * Validates parameters against a schema
   *
   * @param schema Zod schema or DTO class
   * @param params Parameters to validate
   * @returns Validated parameters
   * @throws McpError if validation fails
   */
  validateParameters<T>(
    schema: z.ZodType<T> | Type<unknown>,
    params: unknown,
  ): T {
    if (schema instanceof z.ZodType) {
      try {
        return validateWithZod(schema, params);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const formattedErrors = error.errors
            .map((err) => {
              return `${err.path.join('.')}: ${err.message}`;
            })
            .join(', ');

          this.logger.warn(`Parameter validation failed: ${formattedErrors}`);
          throw new McpError(
            JsonRpcErrorCode.INVALID_PARAMS,
            `Parameter validation failed: ${formattedErrors}`,
          );
        }
        throw error;
      }
    }

    this.logger.debug('Using class-based validation');
    return params as T;
  }

  /**
   * Validates that required parameters are present
   *
   * @param requiredParams Array of required parameter names
   * @param params Parameters object
   * @throws McpError if any required parameter is missing
   */
  validateRequiredParameters(
    requiredParams: string[],
    params: Record<string, unknown>,
  ): void {
    const missingParams = requiredParams.filter((param) => {
      return params[param] === undefined || params[param] === null;
    });

    if (missingParams.length > 0) {
      const errorMessage = `Missing required parameters: ${missingParams.join(', ')}`;
      this.logger.warn(errorMessage);
      throw new McpError(JsonRpcErrorCode.INVALID_PARAMS, errorMessage);
    }
  }

  /**
   * Validates a JSON-RPC request
   *
   * @param request JSON-RPC request object
   * @returns True if the request is valid
   * @throws McpError if the request is invalid
   */
  validateJsonRpcRequest(request: unknown): boolean {
    const schema = z.object({
      jsonrpc: z.literal('2.0'),
      method: z.string(),
      params: z.optional(z.record(z.unknown())),
      id: z.union([z.string(), z.number(), z.null()]).optional(),
    });

    try {
      validateWithZod(schema, request);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const formattedErrors = error.errors
          .map((err) => {
            return `${err.path.join('.')}: ${err.message}`;
          })
          .join(', ');

        const errorMessage = `Invalid JSON-RPC request: ${formattedErrors}`;
        this.logger.warn(errorMessage);
        throw new McpError(JsonRpcErrorCode.INVALID_REQUEST, errorMessage);
      }
      throw error;
    }
  }

  /**
   * Validates a JSON-RPC request is an initialize request
   *
   * @param request JSON-RPC request object
   * @returns True if the request is an initialize request
   */
  isInitializeRequest(request: unknown): boolean {
    try {
      this.validateJsonRpcRequest(request);

      return (request as JsonRpcRequest).method === 'initialize';
    } catch (error) {
      return false;
    }
  }
}
