import { NestFactory } from '@nestjs/core';
import { Module, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpModule } from '../../src/mcp.module';
import { Tool } from '../../src/decorators/tool.decorator';
import { Context } from '../../src/interfaces/mcp-tool.interface';
import { McpTransportType } from '../../src/types/common';

@Injectable()
class GreetingTool {
  @Tool({
    name: 'greet',
    description: 'Greet a user by name',
    parameters: z.object({
      name: z.string().describe('The name to greet'),
    }),
  })
  async execute(args: { name: string }, context: Context) {
    context.log.info(`Greeting ${args.name}`);

    await context.reportProgress({
      progress: 50,
      total: 100,
      message: 'Generating greeting...',
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    await context.reportProgress({
      progress: 100,
      total: 100,
      message: 'Greeting generated',
    });

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${args.name}!`,
        },
      ],
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
        socketIoOptions: {
          path: '/socket.io',
          serveClient: false,
        },
      },
    }),
  ],
  providers: [GreetingTool],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3003);
  console.log('WebSocket MCP Server running on http://localhost:3003/ws');
  console.log('Press Ctrl+C to stop the server');
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
