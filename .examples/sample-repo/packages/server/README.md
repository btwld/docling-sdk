# @nest-mind/mcp-server

NestJS implementation of the Model Context Protocol (MCP) server.

## Installation

```bash
$ pnpm add @nest-mind/mcp-server
# or
$ npm install @nest-mind/mcp-server
# or
$ yarn add @nest-mind/mcp-server
```

## Features

- **Multiple Transport Types**: StreamableHTTP, WebSocket, SSE, STDIO
- **Decorator-Based**: Use `@Tool`, `@Resource`, and `@Prompt` decorators
- **Type Safety**: Full TypeScript support with Zod schema validation
- **Authentication**: Built-in JWT authentication support
- **Error Handling**: Comprehensive error handling with proper JSON-RPC responses
- **Testing**: Built-in testing utilities and mocks

## Quick Start

### 1. Import the Module

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from '@nest-mind/mcp-server';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'My MCP Server',
      version: '1.0.0',
      instructions: 'A powerful MCP server with multiple transport support',
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        endpoint: 'mcp',
        enableResumability: true,
      },
    }),
  ],
})
export class AppModule {}
```

### 2. Create Tools

```typescript
import { Injectable } from '@nestjs/common';
import { Tool } from '@nest-mind/mcp-server';
import { z } from 'zod';

@Injectable()
export class MathService {
  @Tool({
    name: 'add',
    description: 'Add two numbers',
    parameters: z.object({
      a: z.number(),
      b: z.number(),
    }),
  })
  async add({ a, b }: { a: number; b: number }) {
    return { result: a + b };
  }
}
```

## Transport Types

### StreamableHTTP

The StreamableHTTP transport supports both stateful and stateless modes.

#### Stateful Mode (Default)

```typescript
McpModule.forRoot({
  transport: McpTransportType.STREAMABLE_HTTP,
  streamableHttp: {
    endpoint: 'mcp',
    enableResumability: true,
  },
});
```

#### Stateless Mode (Recommended for simplicity)

```typescript
McpModule.forRoot({
  transport: McpTransportType.STREAMABLE_HTTP,
  streamableHttp: {
    endpoint: 'mcp',
    statelessMode: true,
    enableResumability: false,
  },
});
```

**Required Headers for StreamableHTTP:**

```javascript
{
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream'
}
```

### WebSocket

```typescript
McpModule.forRoot({
  transport: McpTransportType.WEBSOCKET,
  websocket: {
    endpoint: 'ws',
    cors: { origin: '*' },
  },
});
```

### Server-Sent Events (SSE)

```typescript
McpModule.forRoot({
  transport: McpTransportType.SSE,
  sse: {
    endpoint: 'sse',
    pingInterval: 30000,
  },
});
```

### Multiple Transports

```typescript
McpModule.forRoot({
  transport: [
    McpTransportType.STREAMABLE_HTTP,
    McpTransportType.WEBSOCKET,
    McpTransportType.SSE,
  ],
  // ... transport-specific options
});
```

## Complete Working Example

Here's a complete example showing how to create a weather service with MCP:

```typescript
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { McpModule, McpTransportType, Tool } from '@nest-mind/mcp-server';

@Injectable()
export class WeatherService {
  @Tool({
    name: 'get_weather',
    description: 'Get current weather for a location',
    parameters: z.object({
      location: z.string().describe('City name or coordinates'),
      units: z.enum(['celsius', 'fahrenheit']).optional().default('celsius'),
    }),
  })
  async getWeather({ location, units }: { location: string; units?: string }) {
    // Your weather API logic here
    return {
      location,
      temperature: units === 'fahrenheit' ? '72°F' : '22°C',
      condition: 'Sunny',
      humidity: '45%',
    };
  }

  @Tool({
    name: 'get_forecast',
    description: 'Get weather forecast for multiple days',
    parameters: z.object({
      location: z.string().describe('City name'),
      days: z.number().min(1).max(7).default(3),
    }),
  })
  async getForecast({ location, days }: { location: string; days: number }) {
    return {
      location,
      forecast: Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        temperature: `${20 + i}°C`,
        condition: i % 2 === 0 ? 'Sunny' : 'Cloudy',
      })),
    };
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      name: 'Weather MCP Server',
      version: '1.0.0',
      instructions: 'Provides weather information and forecasts',
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        endpoint: 'mcp',
        statelessMode: true, // Simpler usage without session management
        enableResumability: false,
      },
    }),
  ],
  providers: [WeatherService],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log('Weather MCP Server running on http://localhost:3000/mcp');
}

bootstrap();
```

### Using the Server

Once running, you can interact with the server using HTTP requests:

```bash
# List available tools
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'

# Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_weather",
      "arguments": {"location": "New York", "units": "fahrenheit"}
    }
  }'
```

## API Reference

See the [main documentation](../../README.md) for complete API reference and examples.

## License

MIT
