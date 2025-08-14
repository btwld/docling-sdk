import { NestFactory } from '@nestjs/core';
import {
  Module,
  Injectable,
  Controller,
  Get,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';

// Simple decorator for MCP tools
function Tool(options: any = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    return descriptor;
  };
}

// Simple context interface
interface Context {
  log: {
    info: (message: string) => void;
  };
  reportProgress: (progress: any) => Promise<void>;
}

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
  async greet(args: { name: string }, context?: Context) {
    // Log the request
    console.log(`Greeting ${args.name}`);

    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${args.name}!`,
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

// Simple MCP controller
@Controller('mcp')
class McpController {
  constructor(private readonly tools: TestTools) {}

  @Post()
  async handlePost(@Req() req: Request, @Res() res: Response) {
    try {
      const body = req.body;

      // Check if it's a tool call
      if (body.method === 'tools/list') {
        return res.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              {
                name: 'greet',
                description: 'Greet a user by name',
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'The name to greet',
                    },
                  },
                  required: ['name'],
                },
              },
              {
                name: 'echo',
                description: 'Echo back the input',
                inputSchema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      description: 'The message to echo',
                    },
                  },
                  required: ['message'],
                },
              },
            ],
          },
        });
      }

      if (body.method === 'tools/call' && body.params.name === 'greet') {
        const result = await this.tools.greet(body.params.arguments);
        return res.json({
          jsonrpc: '2.0',
          id: body.id,
          result,
        });
      }

      if (body.method === 'tools/call' && body.params.name === 'echo') {
        const result = await this.tools.echo(body.params.arguments);
        return res.json({
          jsonrpc: '2.0',
          id: body.id,
          result,
        });
      }

      if (body.method === 'initialize') {
        return res.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            serverInfo: {
              name: 'Test MCP Server',
              version: '1.0.0',
            },
            // No need to manually specify capabilities
            // They will be automatically detected from decorators
            capabilities: {},
          },
        });
      }

      // Default response for unknown methods
      return res.json({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32601,
          message: 'Method not found',
        },
      });
    } catch (error) {
      console.error('Error handling request:', error);
      return res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: 'Internal server error',
        },
      });
    }
  }

  @Get()
  handleGet(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send a test event
    res.write(
      'event: message\nid: test-event-id\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"SSE connection established"}}\n\n',
    );

    // Keep the connection open
    req.on('close', () => {
      console.log('SSE connection closed');
    });
  }
}

@Module({
  controllers: [McpController],
  providers: [TestTools],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use((req, res, next) => {
    if (req.method === 'POST') {
      // Parse JSON body
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          req.body = JSON.parse(data);
          next();
        } catch (e) {
          res.status(400).json({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: 'Parse error',
            },
          });
        }
      });
    } else {
      next();
    }
  });

  await app.listen(3000);
  console.log('MCP Server running on http://localhost:3000/mcp');
  console.log('Press Ctrl+C to stop the server');
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
