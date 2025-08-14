# NestJS MCP Ecosystem

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="center">A comprehensive NestJS ecosystem for the <a href="https://github.com/modelcontextprotocol/modelcontextprotocol" target="_blank">Model Context Protocol (MCP)</a>.</p>

## Description

This monorepo provides a complete NestJS implementation of the Model Context Protocol (MCP) ecosystem. It includes packages for server, client, gateway, and shared utilities, making it easy to build comprehensive MCP-compatible applications.

### Packages

- **[@nest-mind/mcp-server](./packages/server)** - MCP server implementation with support for multiple transports
- **[@nest-mind/mcp-core](./packages/core)** - Shared types, utilities, and core functionality
- **[@nest-mind/mcp-testing](./packages/testing)** - Testing utilities for MCP applications _(coming soon)_
- **[@nest-mind/mcp-client](./packages/client)** - MCP client implementation _(coming soon)_
- **[@nest-mind/mcp-gateway](./packages/gateway)** - MCP gateway/proxy implementation _(coming soon)_
- **[@nest-mind/mcp-cli](./packages/cli)** - CLI tools for MCP development _(coming soon)_

### Transport Support

The server package supports multiple transport types:

- StreamableHTTP
- WebSocket
- Server-Sent Events (SSE)
- Standard I/O (STDIO)

The library uses a decorator-based approach to define tools, resources, and prompts, making it easy to integrate with existing NestJS applications.

## Installation

```bash
# Install the server package
$ pnpm add @nest-mind/mcp-server
# or
$ npm install @nest-mind/mcp-server
# or
$ yarn add @nest-mind/mcp-server
```

## Development

This is a Turbo monorepo. To get started:

```bash
# Install dependencies
$ pnpm install

# Build all packages
$ pnpm run build

# Run tests
$ pnpm run test

# Run linting
$ pnpm run lint
```

## Basic Usage

### 1. Import the McpModule

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from '@nest-mind/mcp-server';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'My MCP Server',
      version: '1.0.0',
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

### 2. Create a Tool

```typescript
import { Injectable } from '@nestjs/common';
import { Tool } from '@nest-mind/mcp-server';
import { z } from 'zod';

@Injectable()
export class GreetingService {
  @Tool({
    name: 'greet',
    description: 'Greet a user by name',
    parameters: z.object({
      name: z.string().describe('The name to greet'),
    }),
  })
  async greet({ name }: { name: string }) {
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${name.toUpperCase()}!`,
        },
      ],
    };
  }
}
```

### 3. Create a Resource

```typescript
import { Injectable } from '@nestjs/common';
import { Resource } from '@nest-mind/mcp-server';

@Injectable()
export class WeatherService {
  @Resource({
    name: 'weather',
    description: 'Get the current weather',
    uri: 'mcp://weather/{city}',
    mimeType: 'application/json',
  })
  async getWeather({ city }: { city: string }) {
    // Fetch weather data for the city
    const weatherData = await this.fetchWeatherData(city);

    return {
      contents: [
        {
          uri: `mcp://weather/${city}`,
          text: JSON.stringify(weatherData),
        },
      ],
    };
  }

  private async fetchWeatherData(city: string) {
    // Implementation details...
    return { temperature: 22, conditions: 'Sunny' };
  }
}
```

### 4. Create a Prompt

```typescript
import { Injectable } from '@nestjs/common';
import { Prompt } from '@nest-mind/mcp-server';

@Injectable()
export class PromptService {
  @Prompt({
    name: 'system-prompt',
    description: 'Get the system prompt',
  })
  async getSystemPrompt() {
    return {
      messages: [
        {
          role: 'system',
          content: {
            type: 'text',
            text: 'You are a helpful assistant.',
          },
        },
      ],
    };
  }
}
```

## Examples

Check out the examples in the `apps/examples/` directory for more detailed usage examples:

- `apps/examples/decorators/` - Examples of using decorators to define tools, resources, and prompts
- `apps/examples/transports/` - Examples of different transport types (StreamableHTTP, SSE, WebSocket)

## Running Examples

```bash
# Run a specific example
$ pnpm --filter @nestjs-mcp/examples run example:decorators:server

# Run example client
$ pnpm --filter @nestjs-mcp/examples run example:decorators:client
```

## Monorepo Structure

```
nestjs-mcp/
├── packages/
│   ├── server/          # @nest-mind/mcp-server - MCP server implementation
│   ├── core/            # @nest-mind/mcp-core - Shared utilities and types
│   ├── client/          # @nest-mind/mcp-client (coming soon)
│   ├── gateway/         # @nest-mind/mcp-gateway (coming soon)
│   ├── testing/         # @nest-mind/mcp-testing (coming soon)
│   └── cli/             # @nest-mind/mcp-cli (coming soon)
├── apps/
│   └── examples/        # Example applications
├── tools/               # Shared build tools and configurations
├── turbo.json          # Turbo configuration
└── pnpm-workspace.yaml # pnpm workspace configuration
```

## Running Tests

```bash
# Run all tests
$ pnpm test

# Run tests for specific package
$ pnpm --filter @nest-mind/mcp-server test

# Run E2E tests
$ pnpm --filter @nest-mind/mcp-server test:e2e
```

## License

This project is [MIT licensed](LICENSE).
