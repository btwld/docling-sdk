import { Injectable, Logger, Type } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AbstractMcpTransportProvider } from '../interfaces/mcp-transport.interface';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { WebSocketController } from '../controllers/websocket.controller';
import { createWebSocketGateway } from '../gateways/websocket.gateway.factory';

/**
 * WebSocket transport provider for MCP
 * Supports Socket.io by default and can be configured for custom WebSocket protocols
 */
@Injectable()
export class WebSocketTransportProvider extends AbstractMcpTransportProvider {
  private readonly logger = new Logger(WebSocketTransportProvider.name);
  readonly name = 'websocket';
  private protocol: string;

  /**
   * Initialize the WebSocket transport
   * @param options MCP options
   */
  async initialize(options: McpOptions): Promise<void> {
    this.protocol = options.websocket?.protocol || 'socket.io';

    this.logger.log(
      `Initializing WebSocket transport with protocol: ${this.protocol}`,
    );

    if (this.protocol !== 'socket.io') {
      this.logger.log(`Using custom WebSocket protocol: ${this.protocol}`);

      if (options.websocket?.protocolOptions) {
        this.logger.debug('Custom protocol options provided');
      }
    }
  }

  /**
   * Get the controllers for the WebSocket transport
   * @param options MCP options
   */
  getControllers(_options: McpOptions): Type<any>[] {
    return [WebSocketController];
  }

  /**
   * Get the providers for the WebSocket transport
   * @param options MCP options
   */
  getProviders(options: McpOptions): Type<any>[] {
    const WebSocketGateway = createWebSocketGateway(options);

    const providers = [WebSocketGateway];

    return providers;
  }

  /**
   * Get the imports for the WebSocket transport
   * @param options MCP options
   */
  getImports(_options: McpOptions): any[] {
    return [];
  }

  /**
   * Create an MCP server instance for the WebSocket transport
   * @param options MCP options
   */
  createServer(options: McpOptions): McpServer {
    this.logger.log(
      `Creating MCP server for WebSocket transport with protocol: ${this.protocol}`,
    );

    return new McpServer(
      { name: options.name, version: options.version },
      {
        capabilities: options.capabilities || {},
        instructions: options.instructions,
      },
    );
  }
}
