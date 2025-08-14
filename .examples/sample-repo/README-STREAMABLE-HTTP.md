# StreamableHTTP Transport for NestJS MCP

This document explains how to use the StreamableHTTP transport in your NestJS MCP application.

## Overview

The StreamableHTTP transport implements the MCP Streamable HTTP transport specification. It provides a more efficient and robust transport mechanism compared to the older SSE transport, with support for:

- Session management
- Reconnection with resumability
- Stateless mode operation
- Both streaming and non-streaming responses

## Configuration

To use the StreamableHTTP transport, configure your McpModule as follows:

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from 'nestjs-mcp';

@Module({
  imports: [
    McpModule.forRoot({
      // You can use a single transport
      transport: McpTransportType.STREAMABLE_HTTP,
      name: 'My MCP Server',
      version: '1.0.0',
      streamableHttp: {
        endpoint: 'mcp', // The endpoint for the StreamableHTTP controller
        enableJsonResponse: false, // Use SSE streaming (default)
        statelessMode: false, // Use stateful mode with session management (default)
        // Optional custom session ID generator
        sessionIdGenerator: () => generateCustomSessionId(),
      },
      // No need to manually specify capabilities
      // They will be automatically detected from decorators
    }),
  ],
  // Your providers with @Tool, @Resource, and @Prompt decorators
  providers: [MyToolsService],
})
export class AppModule {}
```

You can also use multiple transports simultaneously:

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from 'nestjs-mcp';

@Module({
  imports: [
    McpModule.forRoot({
      // Support multiple transports simultaneously
      transport: [
        McpTransportType.STREAMABLE_HTTP,
        McpTransportType.SSE,
        McpTransportType.STDIO,
      ],
      name: 'Multi-Transport MCP Server',
      version: '1.0.0',
      // Session management options
      session: {
        maxConcurrentSessions: 100,
        sessionTimeout: 1800000, // 30 minutes
        maxReconnectAttempts: 5,
      },
      // StreamableHTTP-specific options
      streamableHttp: {
        endpoint: 'mcp',
        enableResumability: true,
      },
      // SSE-specific options
      sse: {
        endpoint: 'sse',
        pingEnabled: true,
      },
      // No need to manually specify capabilities
      // They will be automatically detected from decorators
    }),
  ],
  providers: [MyToolsService],
})
export class AppModule {}
```

## Options

The StreamableHTTP transport supports the following options:

| Option                | Type         | Default              | Description                                                                      |
| --------------------- | ------------ | -------------------- | -------------------------------------------------------------------------------- |
| `endpoint`            | string       | `'mcp'`              | The endpoint path for the StreamableHTTP controller                              |
| `enableJsonResponse`  | boolean      | `false`              | If true, the server will return JSON responses instead of starting an SSE stream |
| `statelessMode`       | boolean      | `false`              | If true, the server will operate in stateless mode (no session management)       |
| `sessionIdGenerator`  | () => string | `() => randomUUID()` | Function that generates a session ID for the transport                           |
| `enableResumability`  | boolean      | `false`              | If true, enables resumability support using the event store                      |
| `enableHealthMonitor` | boolean      | `false`              | If true, enables health monitoring for the MCP server                            |

## Session Management

When using multiple transports or when you need more control over session management, you can configure the session options:

```typescript
McpModule.forRoot({
  transport: McpTransportType.STREAMABLE_HTTP,
  // ... other options
  session: {
    maxConcurrentSessions: 100, // Maximum number of concurrent sessions
    sessionTimeout: 1800000, // Session timeout in milliseconds (30 minutes)
    maxReconnectAttempts: 5, // Maximum number of reconnect attempts
  },
}),
```

These session options apply to all transports that use sessions (StreamableHTTP and SSE).

## Modes of Operation

### Stateful Mode (Default)

In stateful mode:

- Session IDs are generated and tracked
- Clients must include the session ID in subsequent requests
- State is maintained between requests
- Supports reconnection with resumability

### Stateless Mode

In stateless mode:

- No session IDs are generated or required
- Each request is treated independently
- No state is maintained between requests
- Simpler to scale horizontally

## Resumability Support

Resumability allows clients to reconnect and continue from where they left off if a connection is interrupted. This is particularly useful for long-running operations or unreliable network connections.

To enable resumability:

```typescript
McpModule.forRoot({
  transport: McpTransportType.STREAMABLE_HTTP,
  // ... other options
  streamableHttp: {
    enableResumability: true,
  },
}),
```

When resumability is enabled:

1. The server stores events with unique IDs
2. Clients can reconnect with the last event ID they received
3. The server will replay any events that occurred after that ID

By default, an in-memory event store is used. For production environments, you may want to implement a custom event store using Redis or a database for persistence across server restarts.

## Health Monitoring

Health monitoring allows you to track the health of your MCP server and take action if it becomes degraded or unhealthy.

To enable health monitoring:

```typescript
McpModule.forRoot({
  transport: McpTransportType.STREAMABLE_HTTP,
  // ... other options
  streamableHttp: {
    enableHealthMonitor: true,
  },
}),
```

When health monitoring is enabled:

1. The server periodically checks its health status
2. Health metrics like memory usage and CPU load are collected
3. Events are emitted when the health status changes
4. You can subscribe to these events to take action

The health monitor service provides the following methods:

- `getCurrentStatus()`: Get the current health status
- `getLastHealthCheck()`: Get the results of the last health check
- `performHealthCheck()`: Manually trigger a health check

## Client Connection

Clients can connect to your MCP server using the StreamableHTTP transport from the MCP SDK:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';

// Basic connection
const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp'),
);

// With resumability support
const transportWithResumability = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp'),
  {
    // Configure reconnection options
    reconnectionOptions: {
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
      reconnectionDelayGrowFactor: 1.5,
      maxRetries: 5,
    },
  },
);

// Store resumption token when it changes
let lastResumptionToken: string | undefined;
transport.send(message, {
  resumptionToken: lastResumptionToken,
  onresumptiontoken: (token) => {
    lastResumptionToken = token;
    // You might want to persist this token
    localStorage.setItem('resumptionToken', token);
  },
});

// Basic usage
const client = new Client(transport);
await client.connect();

// Now you can call tools, etc.
const result = await client.callTool('greet', { name: 'World' });
console.log(result);
```

## Security

To secure your MCP endpoints, you can use NestJS guards:

```typescript
McpModule.forRoot({
  transport: McpTransportType.STREAMABLE_HTTP,
  // ... other options
  guards: [AuthGuard],
}),
```

This will apply the specified guards to all StreamableHTTP endpoints.
