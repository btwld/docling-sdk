# WebSocket Transport for NestJS MCP Server

This guide explains how to use the WebSocket transport with the NestJS MCP Server.

## Overview

The WebSocket transport uses [Socket.IO](https://socket.io/) to provide a bidirectional, event-based communication channel between the client and server. This transport is ideal for applications that require real-time communication and low latency.

## Configuration

To use the WebSocket transport, configure your McpModule as follows:

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from 'nestjs-mcp';

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.WEBSOCKET,
      name: 'My MCP Server',
      version: '1.0.0',
      websocket: {
        endpoint: 'ws', // The endpoint for WebSocket connections
        sessionTimeout: 1800000, // 30 minutes
        cors: {
          origin: '*',
          methods: ['GET', 'POST'],
          credentials: true,
        },
        socketIoOptions: {
          // Additional Socket.IO options
        },
      },
    }),
  ],
  providers: [MyToolsService],
})
export class AppModule {}
```

## Options

The WebSocket transport supports the following options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | string | `'ws'` | The endpoint path for the WebSocket controller |
| `sessionTimeout` | number | `1800000` | Session timeout in milliseconds (30 minutes) |
| `cors` | object | `{ origin: '*', methods: ['GET', 'POST'], credentials: true }` | CORS options for WebSocket |
| `socketIoOptions` | object | `{}` | Additional Socket.IO options |

## Client Connection

Clients can connect to your MCP server using Socket.IO:

```typescript
import { io } from 'socket.io-client';

// Create a Socket.IO client
const socket = io('http://localhost:3000/ws', {
  transports: ['websocket'],
  reconnection: true,
});

// Initialize the MCP session
socket.emit('initialize', {
  jsonrpc: '2.0',
  method: 'initialize',
  params: {},
  id: 1,
});

// Listen for the result
socket.on('result', (data) => {
  console.log('Result:', data);
});

// Call a tool
socket.emit('call', {
  jsonrpc: '2.0',
  method: 'greet',
  params: { name: 'World' },
  id: 2,
});

// Listen for notifications
socket.on('notification', (data) => {
  console.log('Notification:', data);
});

// Close the connection when done
socket.disconnect();
```

## Events

The WebSocket transport uses the following events:

| Event | Direction | Description |
|-------|-----------|-------------|
| `initialize` | Client → Server | Initialize the MCP session |
| `call` | Client → Server | Call a tool or method |
| `notify` | Client → Server | Send a notification |
| `result` | Server → Client | Result of a method call |
| `error` | Server → Client | Error response |
| `notification` | Server → Client | Server notification |
| `connection` | Server → Client | Connection event |
| `timeout` | Server → Client | Session timeout event |

## Session Management

The WebSocket transport maintains a session for each client connection. Sessions are automatically created when a client connects and initializes the MCP session. Sessions are cleaned up when:

1. The client disconnects
2. The session times out (no activity for the configured timeout period)

## Security

To secure your WebSocket endpoints, you can:

1. Configure CORS options to restrict access to specific origins
2. Implement authentication using Socket.IO middleware
3. Use NestJS guards to protect your WebSocket gateway

Example with authentication middleware:

```typescript
// In your main.ts file
const app = await NestFactory.create(AppModule);
const server = app.getHttpServer();
const io = new Server(server);

// Add authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (isValidToken(token)) {
    next();
  } else {
    next(new Error('Authentication error'));
  }
});

await app.listen(3000);
```

## Example

Here's a complete example of using the WebSocket transport:

```typescript
// server.ts
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
      transport: McpTransportType.WEBSOCKET,
      name: 'WebSocket MCP Server',
      version: '1.0.0',
      websocket: {
        endpoint: 'ws',
      },
    }),
  ],
  providers: [MyToolsService],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log('WebSocket MCP Server running on http://localhost:3000/ws');
}

bootstrap();
```

```typescript
// client.ts
import { io } from 'socket.io-client';

async function runClient() {
  const socket = io('http://localhost:3000/ws', {
    transports: ['websocket'],
  });

  // Set up event listeners
  socket.on('connect', () => {
    console.log('Connected to WebSocket server');
  });

  socket.on('result', (data) => {
    console.log('Result:', data);
  });

  socket.on('error', (data) => {
    console.error('Error:', data);
  });

  // Initialize the MCP session
  socket.emit('initialize', {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {},
    id: 1,
  });

  // Wait a moment for initialization
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Call the greet tool
  socket.emit('call', {
    jsonrpc: '2.0',
    method: 'greet',
    params: { name: 'WebSocket User' },
    id: 2,
  });

  // Wait for the result
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Close the connection
  socket.disconnect();
}

runClient();
```

## Conclusion

The WebSocket transport provides a real-time, bidirectional communication channel for your MCP server. It's ideal for applications that require low latency and real-time updates.
