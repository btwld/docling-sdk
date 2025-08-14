import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from '@nest-mind/mcp-server';
import { ExampleModule } from './example.module';

/**
 * Root module for the example server
 */
@Module({
  imports: [
    ExampleModule,
    McpModule.forRoot({
      name: 'Example MCP Server',
      version: '1.0.0',
      transport: [
        McpTransportType.SSE,
        McpTransportType.STREAMABLE_HTTP,
        McpTransportType.WEBSOCKET,
      ],
      sse: {
        endpoint: 'sse',
      },
      streamableHttp: {
        endpoint: 'streamable-http',
      },
      websocket: {
        endpoint: 'ws',
      },
    }),
  ],
})
class AppModule {}

/**
 * Bootstrap the example server
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log('Example server listening on port 3000');
  console.log('SSE endpoint: http://localhost:3000/sse');
  console.log('StreamableHTTP endpoint: http://localhost:3000/streamable-http');
  console.log('WebSocket endpoint: ws://localhost:3000/ws');
}

bootstrap();
