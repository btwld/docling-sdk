import { Logger } from '@nestjs/common';
import { McpTransportProvider } from '../interfaces/mcp-transport.interface';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { McpTransportType } from '../types/common';
import { WebSocketTransportProvider } from './websocket.transport';
import { StreamableHttpTransportProvider } from './streamable-http.transport';
import { SseTransportProvider } from './sse.transport';
import { StdioTransportProvider } from './stdio.transport';

/**
 * Error class for transport-related errors
 */
export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportError';
  }
}

/**
 * Factory for creating transport providers
 */
export class TransportFactory {
  private static readonly logger = new Logger(TransportFactory.name);

  /**
   * Hash map of transport provider factory functions
   * Using a static member improves performance by avoiding recreation on each call
   */
  private static readonly transportProviderFactories: {
    [key: string]: (options?: McpOptions) => McpTransportProvider;
  } = {
    [McpTransportType.WEBSOCKET]: () => new WebSocketTransportProvider(),
    [McpTransportType.STREAMABLE_HTTP]: () =>
      new StreamableHttpTransportProvider(),
    [McpTransportType.SSE]: () => new SseTransportProvider(),
    [McpTransportType.STDIO]: () => new StdioTransportProvider(),
    [McpTransportType.CUSTOM]: (options?: McpOptions) => {
      if (!options) {
        throw new TransportError(
          'Options are required when using McpTransportType.CUSTOM',
        );
      }
      if (!options.customTransportProvider) {
        throw new TransportError(
          'Custom transport provider is required when using McpTransportType.CUSTOM',
        );
      }

      // Validate that the custom provider implements the required interface
      TransportFactory.validateProvider(options.customTransportProvider);

      return options.customTransportProvider;
    },
  };

  /**
   * Validates that a provider implements the McpTransportProvider interface correctly
   * @param provider The provider to validate
   * @throws TransportError if the provider does not implement the interface correctly
   */
  private static validateProvider(
    provider: unknown,
  ): asserts provider is McpTransportProvider {
    if (
      !provider ||
      typeof provider !== 'object' ||
      typeof (provider as McpTransportProvider).name !== 'string' ||
      typeof (provider as McpTransportProvider).initialize !== 'function' ||
      typeof (provider as McpTransportProvider).getControllers !== 'function' ||
      typeof (provider as McpTransportProvider).getProviders !== 'function' ||
      typeof (provider as McpTransportProvider).getImports !== 'function' ||
      typeof (provider as McpTransportProvider).createServer !== 'function'
    ) {
      throw new TransportError(
        'Custom transport provider does not implement the McpTransportProvider interface correctly',
      );
    }
  }

  /**
   * Create a transport provider for the given transport type
   * @param transportType The transport type
   * @param options MCP options
   * @returns A transport provider instance
   * @throws TransportError if the transport type is not supported or if required options are missing
   */
  static createTransport(
    transportType: McpTransportType,
    options: McpOptions,
  ): McpTransportProvider {
    this.logger.debug(`Creating transport provider for type: ${transportType}`);

    try {
      // Get the provider factory function from the hash map
      const providerFactory = this.transportProviderFactories[transportType];

      // If the transport type is not supported, throw an error
      if (!providerFactory) {
        throw new TransportError(
          `Unsupported transport type: ${transportType}`,
        );
      }

      // Create and return the transport provider
      return providerFactory(options);
    } catch (error) {
      if (error instanceof TransportError) {
        throw error;
      }

      this.logger.error(
        `Error creating transport provider: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new TransportError(
        `Failed to create transport provider: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
