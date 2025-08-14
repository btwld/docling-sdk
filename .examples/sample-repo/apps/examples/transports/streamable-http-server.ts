import { NestFactory } from '@nestjs/core';
import { Module, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpModule } from '../../lib/mcp.module';
import { McpTransportType } from '../../lib/types/common';
import { Tool } from '../../lib/decorators/tool.decorator';
import { Context } from '../../lib/interfaces/mcp-tool.interface';

// Example tool implementation
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
    // Log the request
    context.log.info(`Greeting ${args.name}`);

    // Report progress
    await context.reportProgress({
      progress: 50,
      total: 100,
      message: 'Generating greeting...',
    });

    // Report completion
    await context.reportProgress({
      progress: 100,
      total: 100,
      message: 'Greeting generated',
    });

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${args.name.toUpperCase()}!`,
        },
      ],
    };
  }

  @Tool({
    name: 'greetTwo',
    description: 'Greet a user by name',
    parameters: z.object({
      name: z.string().describe('The name to greet'),
    }),
  })
  async executeTwo(args: { name: string }, context: Context) {
    // Log the request
    context.log.info(`Greeting ${args.name}`);
    context.log.debug(`I'm HERE AGAIN ${args.name}`);

    // Report progress
    await context.reportProgress({
      progress: 50,
      total: 100,
      message: 'Generating greeting...',
    });

    // Report completion
    await context.reportProgress({
      progress: 100,
      total: 100,
      message: 'Greeting generated',
    });

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${args.name.toUpperCase()}!`,
        },
      ],
    };
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.STREAMABLE_HTTP,
      name: 'StreamableHTTP MCP Server',
      version: '1.0.0',
      streamableHttp: {
        endpoint: 'mcp',
        enableJsonResponse: false,
        statelessMode: true,
        enableResumability: true,
      },
    }),
  ],
  providers: [GreetingTool],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3001);
  console.log('StreamableHTTP MCP Server running on http://localhost:3001/mcp');
  console.log('Press Ctrl+C to stop the server');
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
