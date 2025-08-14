import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from '../../../src/mcp.module';
import { Tool } from '../../../src/decorators/tool.decorator';

// Sample tool for testing
@Tool('greet', 'Greet a user by name')
class GreetingTool {
  async execute({ name = 'World' }) {
    return {
      content: [{ type: 'text', text: `Hello, ${name}!` }],
    };
  }
}

// Sample tool for testing
@Tool('echo', 'Echo back the input')
class EchoTool {
  async execute({ message }) {
    return {
      content: [{ type: 'text', text: message }],
    };
  }
}

// Create a module for testing
@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.WEBSOCKET,
      name: 'Test WebSocket MCP Server',
      version: '1.0.0',
      websocket: {
        endpoint: 'ws',
      },
    }),
  ],
  providers: [GreetingTool, EchoTool],
})
class AppModule {}

// Main function to start the server
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3001);
  console.log('WebSocket MCP Server running on http://localhost:3001/ws');
  console.log('Press Ctrl+C to stop the server');
}

// Start the server
bootstrap();
