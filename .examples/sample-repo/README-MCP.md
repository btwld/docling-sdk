# NestJS MCP Server

A NestJS implementation of the Model Context Protocol (MCP) server.

## Features

- **Multiple Transports**: Support for STDIO, SSE, StreamableHTTP, WebSocket, and custom transports
- **Automatic Capability Detection**: Automatically detects tools, resources, and prompts from decorators
- **Session Management**: Robust session management for stateful transports
- **Resumability**: Support for resuming interrupted connections
- **Health Monitoring**: Built-in health monitoring for the MCP server
- **Error Handling**: Comprehensive error handling and validation
- **Extensibility**: Easy to extend with custom transports and capabilities

## Installation

```bash
npm install nestjs-mcp
```

Or with pnpm:

```bash
pnpm add nestjs-mcp
```

## Quick Start

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from 'nestjs-mcp';
import { Tool } from 'nestjs-mcp/decorators';
import { Injectable } from '@nestjs/common';

@Injectable()
class MyToolsService {
  @Tool({
    name: 'greet',
    description: 'Greet a user by name',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name to greet' },
      },
      required: ['name'],
    },
  })
  async greet(params: { name: string }) {
    return {
      content: [{ type: 'text', text: `Hello, ${params.name}!` }],
    };
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.STREAMABLE_HTTP,
      name: 'My MCP Server',
      version: '1.0.0',
      streamableHttp: {
        endpoint: 'mcp',
      },
    }),
  ],
  providers: [MyToolsService],
})
export class AppModule {}
```

## Transports

The MCP server supports the following transports:

- **STDIO**: For command-line tools
- **SSE**: For Server-Sent Events
- **StreamableHTTP**: For HTTP with SSE streaming
- **WebSocket**: For WebSocket connections
- **Custom**: For implementing your own transport protocols

You can use multiple transports simultaneously to support different client types:

```typescript
@Module({
  imports: [
    McpModule.forRoot({
      transport: [
        McpTransportType.STREAMABLE_HTTP,
        McpTransportType.WEBSOCKET,
      ],
      name: 'Multi-Transport MCP Server',
      version: '1.0.0',
      streamableHttp: {
        endpoint: 'mcp',
      },
      websocket: {
        endpoint: 'ws',
      },
    }),
  ],
  providers: [MyToolsService],
})
export class AppModule {}
```

## Decorators

The MCP server provides decorators for defining tools, resources, and prompts:

### Tool Decorator

```typescript
@Tool({
  name: 'greet',
  description: 'Greet a user by name',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name to greet' },
    },
    required: ['name'],
  },
})
async greet(params: { name: string }) {
  return {
    content: [{ type: 'text', text: `Hello, ${params.name}!` }],
  };
}
```

### Resource Decorator

```typescript
@Resource({
  name: 'user',
  description: 'User resource',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'User ID' },
      name: { type: 'string', description: 'User name' },
    },
    required: ['id', 'name'],
  },
})
async getUser(params: { id: string }) {
  return {
    id: params.id,
    name: 'John Doe',
  };
}
```

### Prompt Decorator

```typescript
@Prompt({
  name: 'greeting',
  description: 'Greeting prompt',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name to greet' },
    },
    required: ['name'],
  },
})
async getGreetingPrompt(params: { name: string }) {
  return `Hello, ${params.name}! How can I help you today?`;
}
```

## Custom Transports

You can create your own custom transports by implementing the `McpTransportProvider` interface or extending the `AbstractMcpTransportProvider` class:

```typescript
import { AbstractMcpTransportProvider } from 'nestjs-mcp/interfaces/mcp-transport.interface';
import { McpOptions } from 'nestjs-mcp/interfaces';

class MyCustomTransportProvider extends AbstractMcpTransportProvider {
  readonly name = 'my-custom-transport';

  async initialize(options: McpOptions): Promise<void> {
    console.log('Initializing custom transport');
  }

  getControllers(options: McpOptions): Type<any>[] {
    return [MyCustomController];
  }

  getProviders(options: McpOptions): Type<any>[] {
    return [MyCustomService];
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.CUSTOM,
      name: 'Custom Transport MCP Server',
      version: '1.0.0',
      customTransportProvider: new MyCustomTransportProvider(),
    }),
  ],
  providers: [MyToolsService],
})
export class AppModule {}
```

For more information on custom transports, see [README-CUSTOM-TRANSPORTS.md](README-CUSTOM-TRANSPORTS.md).

## Transport-Specific Documentation

- [StreamableHTTP Transport](README-STREAMABLE-HTTP.md)
- [WebSocket Transport](README-WEBSOCKET.md)
- [SSE Transport](README-SSE.md)
- [STDIO Transport](README-STDIO.md)
- [Custom Transports](README-CUSTOM-TRANSPORTS.md)

## License

MIT
