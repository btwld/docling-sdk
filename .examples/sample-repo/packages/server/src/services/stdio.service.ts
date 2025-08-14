import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { McpExecutorService } from './mcp-executor.service';
import { McpErrorHandlerService } from './mcp-error-handler.service';
import { McpValidationsService } from './mcp-validations.service';

/**
 * Service for handling STDIO transport
 */
@Injectable()
export class StdioService implements OnModuleInit {
  private readonly logger = new Logger(StdioService.name);

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    private readonly moduleRef: ModuleRef,
    private readonly errorHandler: McpErrorHandlerService,
    private readonly validations: McpValidationsService,
  ) {}

  /**
   * Initialize the STDIO service
   */
  onModuleInit() {
    if (this.options.transport === 'stdio') {
      this.logger.log('Initializing STDIO transport');
      this.setupStdioHandlers();
    }
  }

  /**
   * Set up STDIO handlers
   */
  private setupStdioHandlers() {
    process.stdin.on('data', async (data) => {
      try {
        const input = data.toString().trim();
        let request;

        try {
          request = JSON.parse(input);
        } catch (error) {
          this.sendErrorResponse(null, {
            code: -32700,
            message: 'Parse error',
            data: { error: error.message },
          });
          return;
        }

        try {
          this.validations.validateJsonRpcRequest(request);
        } catch (error) {
          this.sendErrorResponse(request.id || null, {
            code: -32600,
            message: 'Invalid request',
            data: { error: error.message },
          });
          return;
        }

        const { method, params, id } = request;

        const contextId = ContextIdFactory.create();
        const executorService = await this.moduleRef.resolve(
          McpExecutorService,
          contextId,
        );

        const result = await executorService.executeMethod(method, params);

        this.sendResponse(id, result);
      } catch (error) {
        const errorResponse = this.errorHandler.handleError(null, error);

        this.sendRawResponse(errorResponse);
      }
    });

    process.on('SIGINT', () => {
      this.logger.log('Received SIGINT, exiting');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      this.logger.log('Received SIGTERM, exiting');
      process.exit(0);
    });

    this.logger.log('STDIO transport ready');
  }

  /**
   * Send a response to stdout
   *
   * @param id Request ID
   * @param result Result data
   */
  private sendResponse(id: string | number | null, result: any) {
    const response = {
      jsonrpc: '2.0',
      id,
      result,
    };

    this.sendRawResponse(response);
  }

  /**
   * Send an error response to stdout
   *
   * @param id Request ID
   * @param error Error object
   */
  private sendErrorResponse(id: string | number | null, error: any) {
    const response = {
      jsonrpc: '2.0',
      id,
      error,
    };

    this.sendRawResponse(response);
  }

  /**
   * Send a raw response to stdout
   *
   * @param response Response object
   */
  private sendRawResponse(response: any) {
    try {
      const json = JSON.stringify(response);
      process.stdout.write(json + '\n');
    } catch (error) {
      this.logger.error('Failed to send response', error);
    }
  }
}
