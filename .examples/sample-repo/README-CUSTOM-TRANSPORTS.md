# Custom Transports for NestJS MCP Server

This guide explains how to create and use custom transports with the NestJS MCP Server.

## Overview

The NestJS MCP Server supports several built-in transports:

- **STDIO**: For command-line tools
- **SSE**: For Server-Sent Events
- **StreamableHTTP**: For HTTP with SSE streaming
- **WebSocket**: For WebSocket connections

However, you can also create your own custom transports to support any protocol or communication method.

## Creating a Custom Transport

To create a custom transport, you need to implement the `McpTransportProvider` interface or extend the `AbstractMcpTransportProvider` class.

### Step 1: Implement the Transport Provider

```typescript
import { Type } from '@nestjs/common';
import { AbstractMcpTransportProvider } from 'nestjs-mcp/interfaces/mcp-transport.interface';
import { McpOptions } from 'nestjs-mcp/interfaces';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Custom transport provider
 */
export class MyCustomTransportProvider extends AbstractMcpTransportProvider {
  readonly name = 'my-custom-transport';

  /**
   * Initialize the custom transport
   */
  async initialize(options: McpOptions): Promise<void> {
    console.log('Initializing custom transport');
  }

  /**
   * Get the controllers for this transport
   */
  getControllers(options: McpOptions): Type<any>[] {
    // Return your custom controllers
    return [MyCustomController];
  }

  /**
   * Get the providers for this transport
   */
  getProviders(options: McpOptions): Type<any>[] {
    // Return your custom providers
    return [MyCustomService];
  }

  /**
   * Get the imports for this transport
   */
  getImports(options: McpOptions): any[] {
    // Return any NestJS modules that your transport needs
    return [];
  }

  /**
   * Create an MCP server instance
   */
  createServer(options: McpOptions): McpServer {
    // Create a standard MCP server or customize it
    return super.createServer(options);
  }
}
```

### Step 2: Create Controllers and Services

Create any controllers and services that your transport needs:

```typescript
import { Controller, Injectable } from '@nestjs/common';

@Controller()
export class MyCustomController {
  // Your controller implementation
}

@Injectable()
export class MyCustomService {
  // Your service implementation
}
```

### Step 3: Use Your Custom Transport

Use your custom transport in your NestJS application:

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from 'nestjs-mcp';
import { MyCustomTransportProvider } from './my-custom-transport.provider';

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.CUSTOM,
      name: 'My MCP Server',
      version: '1.0.0',
      customTransportProvider: new MyCustomTransportProvider(),
    }),
  ],
  providers: [MyToolsService],
})
export class AppModule {}
```

## WebSocket Transport Example

The NestJS MCP Server includes a WebSocket transport implementation that you can use as a reference:

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from 'nestjs-mcp';

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.WEBSOCKET,
      name: 'WebSocket MCP Server',
      version: '1.0.0',
      websocket: {
        endpoint: 'ws', // The endpoint for WebSocket connections
        sessionTimeout: 1800000, // 30 minutes
        cors: {
          origin: '*',
          methods: ['GET', 'POST'],
          credentials: true,
        },
      },
    }),
  ],
  providers: [MyToolsService],
})
export class AppModule {}
```

## Using Multiple Transports

You can use multiple transports simultaneously, including your custom transport:

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from 'nestjs-mcp';
import { MyCustomTransportProvider } from './my-custom-transport.provider';

@Module({
  imports: [
    McpModule.forRoot({
      transport: [
        McpTransportType.STREAMABLE_HTTP,
        McpTransportType.WEBSOCKET,
        McpTransportType.CUSTOM,
      ],
      name: 'Multi-Transport MCP Server',
      version: '1.0.0',
      // StreamableHTTP-specific options
      streamableHttp: {
        endpoint: 'mcp',
      },
      // WebSocket-specific options
      websocket: {
        endpoint: 'ws',
      },
      // Custom transport provider
      customTransportProvider: new MyCustomTransportProvider(),
    }),
  ],
  providers: [MyToolsService],
})
export class AppModule {}
```

## Best Practices

1. **Separation of Concerns**: Keep your transport logic separate from your business logic.
2. **Error Handling**: Implement robust error handling in your custom transport.
3. **Logging**: Add detailed logging to help with debugging.
4. **Testing**: Write tests for your custom transport.
5. **Documentation**: Document how to use your custom transport.

## Advanced Topics

### Creating a Transport Adapter

If you're integrating with an existing protocol or library, you might want to create a transport adapter that bridges between the MCP protocol and the existing protocol.

### Custom Session Management

If your transport needs custom session management, you can implement your own session management logic in your transport provider.

### Custom Authentication

You can implement custom authentication for your transport by adding guards to your controllers or by implementing authentication logic in your transport provider.

## Conclusion

Custom transports give you the flexibility to integrate MCP with any protocol or communication method. By implementing the `McpTransportProvider` interface, you can create transports that work seamlessly with the NestJS MCP Server.
