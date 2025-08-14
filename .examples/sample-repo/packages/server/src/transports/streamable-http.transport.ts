import { Injectable, Logger, Type } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AbstractMcpTransportProvider } from '../interfaces/mcp-transport.interface';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { StreamableHttpController } from '../controllers/streamable-http.controller';
import { McpEventStoreService } from '../services/mcp-event-store.service';

/**
 * StreamableHTTP transport provider for MCP
 * Implements the AbstractMcpTransportProvider interface
 */
@Injectable()
export class StreamableHttpTransportProvider extends AbstractMcpTransportProvider {
  private readonly logger = new Logger(StreamableHttpTransportProvider.name);
  readonly name = 'streamable-http';

  /**
   * Initialize the StreamableHTTP transport
   * @param options MCP options
   */
  async initialize(options: McpOptions): Promise<void> {
    this.logger.log('Initializing StreamableHTTP transport');
  }

  /**
   * Get the controllers for the StreamableHTTP transport
   * @param options MCP options
   */
  getControllers(options: McpOptions): Type<any>[] {
    return [StreamableHttpController];
  }

  /**
   * Get the providers for the StreamableHTTP transport
   * @param options MCP options
   */
  getProviders(options: McpOptions): Type<any>[] {
    const providers: Type<any>[] = [];

    if (options.streamableHttp?.enableResumability) {
      providers.push(McpEventStoreService);
    }

    return providers;
  }

  /**
   * Get the imports for the StreamableHTTP transport
   * @param options MCP options
   */
  getImports(options: McpOptions): any[] {
    const endpoint = options.streamableHttp?.endpoint || 'mcp';

    return [];
  }

  /**
   * Create an MCP server instance for the StreamableHTTP transport
   * @param options MCP options
   */
  createServer(options: McpOptions): McpServer {
    this.logger.log('Creating MCP server for StreamableHTTP transport');

    return new McpServer(
      { name: options.name, version: options.version },
      {
        capabilities: options.capabilities || {},
        instructions: options.instructions,
      },
    );
  }
}
