import { Injectable, Logger, Type } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AbstractMcpTransportProvider } from '../interfaces/mcp-transport.interface';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { createSseController } from '../controllers/sse.controller.factory';
import { SsePingService } from '../services/sse-ping.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { McpErrorHandlerService } from '../services/mcp-error-handler.service';
import { McpValidationsService } from '../services/mcp-validations.service';

/**
 * SSE (Server-Sent Events) transport provider for MCP
 * Implements the AbstractMcpTransportProvider interface
 */
@Injectable()
export class SseTransportProvider extends AbstractMcpTransportProvider {
  private readonly logger = new Logger(SseTransportProvider.name);
  readonly name = 'sse';

  /**
   * Initialize the SSE transport
   * @param options MCP options
   */
  async initialize(options: McpOptions): Promise<void> {
    this.logger.log('Initializing SSE transport');
  }

  /**
   * Get the controllers for the SSE transport
   * @param options MCP options
   */
  getControllers(options: McpOptions): Type<any>[] {
    const sseEndpoint = options.sse?.endpoint || 'sse';
    const messagesEndpoint = options.sse?.messagesEndpoint || 'messages';
    const globalPrefix = options.globalApiPrefix || '';
    const guards = options.guards || [];

    const SseController = createSseController(
      sseEndpoint,
      messagesEndpoint,
      globalPrefix,
      guards,
    );

    this.logger.log(`Created SSE controller at /${sseEndpoint}`);
    this.logger.log(
      `SSE messages endpoint: /${sseEndpoint}/${messagesEndpoint}`,
    );

    return [SseController];
  }

  /**
   * Get the providers for the SSE transport
   * @param options MCP options
   */
  getProviders(options: McpOptions): Type<any>[] {
    return [SsePingService, McpErrorHandlerService, McpValidationsService];
  }

  /**
   * Get the imports for the SSE transport
   * @param options MCP options
   */
  getImports(options: McpOptions): any[] {
    return [EventEmitterModule.forRoot()];
  }

  /**
   * Create an MCP server instance for the SSE transport
   * @param options MCP options
   */
  createServer(options: McpOptions): McpServer {
    this.logger.log('Creating MCP server for SSE transport');

    return new McpServer(
      { name: options.name, version: options.version },
      {
        capabilities: options.capabilities || {},
        instructions: options.instructions,
      },
    );
  }
}
