import { DynamicModule, Type } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpOptions } from './mcp-options.interface';
import { TypedServerCapabilities } from '../types/common';

/**
 * Interface for MCP transport providers
 * All custom transports must implement this interface
 */
export interface McpTransportProvider {
  /**
   * The name of the transport
   */
  readonly name: string;

  /**
   * Initialize the transport
   * @param options MCP options
   */
  initialize(options: McpOptions): Promise<void>;

  /**
   * Get the controllers for this transport
   * @param _options MCP options (unused in base implementation)
   * @returns Array of controller types
   */
  getControllers(_options: McpOptions): Type<unknown>[];

  /**
   * Get the providers for this transport
   * @param _options MCP options (unused in base implementation)
   * @returns Array of provider types
   */
  getProviders(_options: McpOptions): Type<unknown>[];

  /**
   * Get the imports for this transport
   * @param _options MCP options (unused in base implementation)
   * @returns Array of module imports
   */
  getImports(
    _options: McpOptions,
  ): Array<Type<unknown> | DynamicModule | Promise<DynamicModule>>;

  /**
   * Create an MCP server instance
   * @param options MCP options
   * @returns Configured MCP server instance
   */
  createServer(options: McpOptions): McpServer;
}

/**
 * Abstract class for MCP transport providers
 * Provides default implementations for some methods
 */
export abstract class AbstractMcpTransportProvider
  implements McpTransportProvider
{
  abstract readonly name: string;

  /**
   * Initialize the transport
   * @param options MCP options
   */
  async initialize(options: McpOptions): Promise<void> {}

  /**
   * Get the controllers for this transport
   * @param _options MCP options (unused in base implementation)
   * @returns Array of controller types
   */
  getControllers(_options: McpOptions): Type<unknown>[] {
    return [];
  }

  /**
   * Get the providers for this transport
   * @param _options MCP options (unused in base implementation)
   * @returns Array of provider types
   */
  getProviders(_options: McpOptions): Type<unknown>[] {
    return [];
  }

  /**
   * Get the imports for this transport
   * @param _options MCP options (unused in base implementation)
   * @returns Array of module imports
   */
  getImports(
    _options: McpOptions,
  ): Array<Type<unknown> | DynamicModule | Promise<DynamicModule>> {
    return [];
  }

  /**
   * Create an MCP server instance
   * @param options MCP options
   * @returns Configured MCP server instance
   */
  createServer(options: McpOptions): McpServer {
    const serverCapabilities: TypedServerCapabilities =
      options.capabilities || {};

    return new McpServer(
      { name: options.name, version: options.version },
      {
        capabilities: serverCapabilities,
        instructions: options.instructions,
      },
    );
  }
}
