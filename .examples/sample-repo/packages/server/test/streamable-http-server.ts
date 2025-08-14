import { NestFactory } from '@nestjs/core';
import { Module, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpModule, McpTransportType, Tool, Context } from '../src';

// Example tool implementation
@Injectable()
class TestTools {
  @Tool({
    name: 'greet',
    description: 'Greet a user by name',
    parameters: z.object({
      name: z.string().describe('The name to greet'),
    }),
  })
  async greet(args: { name: string }, context: Context) {
    // Log the request
    context.log.info(`Greeting ${args.name}`);

    // Report progress
    await context.reportProgress({
      percentage: 50,
      message: 'Generating greeting...',
    });

    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Report completion
    await context.reportProgress({
      percentage: 100,
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
    name: 'echo',
    description: 'Echo back the input',
    parameters: z.object({
      message: z.string().describe('The message to echo'),
    }),
  })
  async echo(args: { message: string }) {
    return {
      content: [
        {
          type: 'text',
          text: args.message,
        },
      ],
    };
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.STREAMABLE_HTTP,
      name: 'Test MCP Server',
      version: '1.0.0',
      streamableHttp: {
        endpoint: 'mcp',
        enableJsonResponse: false,
        statelessMode: false,
        enableResumability: true,
      },
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      },
    }),
  ],
  providers: [TestTools],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log('MCP Server running on http://localhost:3000/mcp');
  console.log('Press Ctrl+C to stop the server');
}

bootstrap();
