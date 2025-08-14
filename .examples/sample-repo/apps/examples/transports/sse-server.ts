import { NestFactory } from '@nestjs/core';
import { Module, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { McpModule } from '../../lib/mcp.module';
import { Tool } from '../../lib/decorators/tool.decorator';
import { Resource } from '../../lib/decorators/resource.decorator';
import { Prompt } from '../../lib/decorators/prompt.decorator';
import { Context } from '../../lib/interfaces/mcp-tool.interface';
import { McpTransportType } from '../../lib/types/common';
import { McpRegistryService } from '../../lib/services/mcp-registry.service';

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
  async execute(args: { name: string }, context?: Context) {
    // Use context for logging and progress reporting
    if (context) {
      // Log the greeting
      context.log.info(`Greeting ${args.name}`);

      // Report progress at 50%
      await context.reportProgress({
        progress: 50,
        total: 100,
        message: 'Generating greeting...',
      });

      // Simulate processing
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Report progress at 100%
      await context.reportProgress({
        progress: 100,
        total: 100,
        message: 'Greeting generated',
      });
    } else {
      console.log(`Greeting ${args.name} (no context)`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

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

// Example resource implementation
@Injectable()
class ExampleResource {
  @Resource({
    name: 'example/resource',
    uri: 'example/resource',
    description: 'An example resource',
  })
  async read(_params: Record<string, unknown>, context?: Context) {
    // Use context for logging
    if (context) {
      context.log.info('Reading example resource');
    } else {
      console.log('Reading example resource (no context)');
    }

    // Simulate processing
    await new Promise((resolve) => setTimeout(resolve, 300));

    return {
      contents: [
        {
          uri: 'example/resource',
          type: 'text/plain',
          text: 'This is an example resource content',
        },
      ],
    };
  }
}

// Example prompt implementation
@Injectable()
class ExamplePrompt {
  @Prompt({
    name: 'example_prompt',
    description: 'An example prompt',
    parameters: z.object({
      style: z.string().optional().describe('The style of the prompt'),
      temperature: z.string().optional().describe('The temperature setting'),
    }),
  })
  async getPrompt(args: Record<string, unknown>, context?: Context) {
    // Use context for logging
    if (context) {
      context.log.info('Getting example prompt');
    } else {
      console.log('Getting example prompt (no context)');
    }

    // Simulate processing
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Safely extract style and temperature with proper type handling
    const style = typeof args.style === 'string' ? args.style : 'default';
    const temperature =
      typeof args.temperature === 'string' ? args.temperature : '0.7';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `This is an example prompt with style=${style} and temperature=${temperature}`,
          },
        },
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: "I understand. You've provided an example prompt with style and temperature arguments. How would you like me to proceed?",
          },
        },
      ],
    };
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.SSE,
      name: 'SSE MCP Server',
      version: '1.0.0',
      sse: {
        endpoint: 'sse',
        messagesEndpoint: 'messages',
        pingEnabled: true,
        pingIntervalMs: 10000, // Send ping every 10 seconds
      },
      // Define capabilities explicitly to match StreamableHTTP server
      capabilities: {
        notifications: {
          logging: true,
          progress: true,
          // Add other notification types if needed
          message: true,
          status: true,
        },
        // Add other capabilities if needed
        streaming: true,
        reconnect: true,
        cancel: true,
      },
    }),
  ],
  providers: [
    {
      provide: GreetingTool,
      useClass: GreetingTool,
    },
    {
      provide: ExampleResource,
      useClass: ExampleResource,
    },
    {
      provide: ExamplePrompt,
      useClass: ExamplePrompt,
    },
  ],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // No need to create instances manually as they are provided by the module

  // Add the instances to the app
  app.get(McpRegistryService).registerTool(
    {
      name: 'greet',
      description: 'Greet a user by name',
      parameters: z.object({
        name: z.string().describe('The name to greet'),
      }),
    },
    GreetingTool,
    'execute',
  );

  app
    .get(McpRegistryService)
    .registerResource(
      { uri: 'example/resource', name: 'example/resource' },
      ExampleResource,
      'read',
    );

  app.get(McpRegistryService).registerPrompt(
    {
      name: 'example_prompt',
      description: 'An example prompt',
      parameters: z.object({
        style: z.string().optional().describe('The style of the prompt'),
        temperature: z.string().optional().describe('The temperature setting'),
      }),
    },
    ExamplePrompt,
    'getPrompt',
  );

  // Use port 3003 instead of 3002
  const port = 3003;
  await app.listen(port);
  console.log(`SSE MCP Server running on http://localhost:${port}/sse`);
  console.log('Press Ctrl+C to stop the server');
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
