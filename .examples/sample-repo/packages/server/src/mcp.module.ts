import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import {
  McpOptions,
  McpAsyncOptions,
  McpOptionsFactory,
} from './interfaces/mcp-options.interface';
import { McpRegistryService } from './services/mcp-registry.service';
import { McpDiscoveryService } from './services/mcp-discovery.service';
import { McpExecutorService } from './services/mcp-executor.service';
import { McpErrorHandlerService } from './services/mcp-error-handler.service';
import { McpValidationsService } from './services/mcp-validations.service';
import { McpLoggingService } from './services/mcp-logging.service';
import { TransportFactory } from './transports/transport.factory';

/**
 * MCP Module for NestJS
 * Provides Model Context Protocol (MCP) functionality
 */
@Module({
  imports: [DiscoveryModule, EventEmitterModule.forRoot()],
  providers: [
    McpRegistryService,
    McpDiscoveryService,
    McpExecutorService,
    McpErrorHandlerService,
    McpValidationsService,
    McpLoggingService,
  ],
})
export class McpModule {
  /**
   * Create a dynamic module with the given options
   * @param options MCP options
   */
  static async forRoot(options: McpOptions): Promise<DynamicModule> {
    const providers: Provider[] = [
      {
        provide: 'MCP_OPTIONS',
        useValue: options,
      },
      McpRegistryService,
      McpDiscoveryService,
      McpExecutorService,
      McpErrorHandlerService,
      McpValidationsService,
      McpLoggingService,
    ];

    const imports = [DiscoveryModule, EventEmitterModule.forRoot()];
    const controllers = [];

    const transports = Array.isArray(options.transport)
      ? options.transport
      : [options.transport];

    for (const transportType of transports) {
      try {
        const transportProvider = TransportFactory.createTransport(
          transportType,
          options,
        );

        await transportProvider.initialize(options);

        const transportControllers = transportProvider.getControllers(options);
        controllers.push(...transportControllers);

        const transportProviders = transportProvider.getProviders(options);
        for (const provider of transportProviders) {
          if (!providers.includes(provider)) {
            providers.push(provider);
          }
        }

        const transportImports = transportProvider.getImports(options);
        if (transportImports && Array.isArray(transportImports)) {
          for (const importItem of transportImports) {
            if (importItem) {
              imports.push(importItem as any);
            }
          }
        }
      } catch (error) {
        console.error(`Error initializing transport ${transportType}:`, error);
        throw error;
      }
    }

    return {
      module: McpModule,
      imports,
      providers,
      controllers,
      exports: providers,
    };
  }

  /**
   * Create a dynamic module with async options
   * @param options Async MCP options
   */
  static forRootAsync(options: McpAsyncOptions): DynamicModule {
    const providers: Provider[] = this.createAsyncProviders(options);

    providers.push(
      McpRegistryService,
      McpDiscoveryService,
      McpExecutorService,
      McpErrorHandlerService,
      McpValidationsService,
      McpLoggingService,
    );

    return {
      module: McpModule,
      imports: [
        ...(options.imports || []),
        DiscoveryModule,
        EventEmitterModule.forRoot(),
      ],
      providers,
      exports: [
        McpRegistryService,
        McpDiscoveryService,
        McpExecutorService,
        McpErrorHandlerService,
        McpValidationsService,
        McpLoggingService,
      ],
    };
  }

  /**
   * Helper to create async providers that handle different options types
   */
  private static createAsyncProviders(options: McpAsyncOptions): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }

    if (!options.useClass) {
      throw new Error(
        'useClass must be defined when not using useExisting or useFactory',
      );
    }

    return [
      this.createAsyncOptionsProvider(options),
      {
        provide: options.useClass,
        useClass: options.useClass,
      } as Provider,
    ];
  }

  /**
   * Create the async options provider
   */
  private static createAsyncOptionsProvider(
    options: McpAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: 'MCP_OPTIONS',
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    const injectionToken = options.useExisting || options.useClass;
    if (!injectionToken) {
      throw new Error(
        'Either useExisting or useClass must be defined when not using useFactory',
      );
    }

    return {
      provide: 'MCP_OPTIONS',
      useFactory: async (optionsFactory: McpOptionsFactory) =>
        await optionsFactory.createMcpOptions(),
      inject: [injectionToken],
    };
  }
}
