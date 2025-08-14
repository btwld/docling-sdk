import { Injectable, Logger, Type } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AbstractMcpTransportProvider } from '../interfaces/mcp-transport.interface';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { StdioService } from '../services/stdio.service';

/**
 * STDIO transport provider for MCP
 * Implements the AbstractMcpTransportProvider interface
 */
@Injectable()
export class StdioTransportProvider extends AbstractMcpTransportProvider {
  private readonly logger = new Logger(StdioTransportProvider.name);
  readonly name = 'stdio';

  /**
   * Initialize the STDIO transport
   * @param options MCP options
   */
  async initialize(_options: McpOptions): Promise<void> {
    this.logger.log('Initializing STDIO transport');
  }

  /**
   * Get the controllers for the STDIO transport
   * @param _options MCP options (unused in this implementation)
   */
  getControllers(_options: McpOptions): Type<any>[] {
    return [];
  }

  /**
   * Get the providers for the STDIO transport
   * @param _options MCP options (unused in this implementation)
   */
  getProviders(_options: McpOptions): Type<any>[] {
    return [StdioService];
  }

  /**
   * Get the imports for the STDIO transport
   * @param _options MCP options (unused in this implementation)
   */
  getImports(_options: McpOptions): any[] {
    return [];
  }

  /**
   * Create an MCP server instance for the STDIO transport
   * @param options MCP options
   */
  createServer(options: McpOptions): McpServer {
    this.logger.log('Creating MCP server for STDIO transport');

    return new McpServer(
      { name: options.name, version: options.version },
      {
        capabilities: options.capabilities || {},
        instructions: options.instructions,
      },
    );
  }
}
