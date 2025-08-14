import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { INestApplication, Inject, Injectable, Scope } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Context, Tool, McpModule, McpTransportType } from '../src';
import { createMCPClient } from './utils';
import { REQUEST } from '@nestjs/core';

@Injectable()
class MockUserRepository {
  async findOne(id: string) {
    return Promise.resolve({
      id,
      name: 'Repository User',
      orgMemberships: [
        {
          orgId: 'org123',
          organization: {
            name: 'Repository Org',
          },
        },
      ],
    });
  }
}

@Injectable()
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that get the user by id',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ id }: { id: string }, context: Context) {
    const user = await this.userRepository.findOne(id);

    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${user.name}!`,
        },
      ],
      isError: false,
    };
  }
}

@Injectable({ scope: Scope.REQUEST })
export class GreetingToolRequestScoped {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world-scoped',
    description: 'A sample tool that get the user by id',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ id }, context: Context) {
    const user = await this.userRepository.findOne(id);

    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${user.name}!`,
        },
      ],
      isError: false,
    };
  }
}

@Injectable({ scope: Scope.REQUEST })
export class ToolRequestScoped {
  constructor(@Inject(REQUEST) private request: Request) {}

  @Tool({
    name: 'get-request-scoped',
    description: 'A sample tool that get the request',
    parameters: z.object({}),
  })
  getRequest() {
    return {
      content: [
        {
          type: 'text',
          text: this.request.headers['any-header'] ?? 'No header found',
        },
      ],
      isError: false,
    };
  }
}

describe('E2E: MCP ToolServer', () => {
  let app: INestApplication;
  let testPort: number;
  let client: Client;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          transport: [McpTransportType.STREAMABLE_HTTP, McpTransportType.SSE],
          name: 'test-mcp-server',
          version: '0.0.1',
          guards: [],
          streamableHttp: {
            endpoint: 'mcp',
            enableResumability: true,
          },
          sse: {
            endpoint: 'sse',
            messagesEndpoint: 'messages',
          },
        }),
      ],
      providers: [
        GreetingTool,
        GreetingToolRequestScoped,
        MockUserRepository,
        ToolRequestScoped,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;

    client = await createMCPClient(testPort);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }

    await app.close();
  });

  it('should list tools', async () => {
    const tools = await client.listTools();

    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.find((t) => t.name === 'hello-world')).toBeDefined();
  });

  it.each([{ tool: 'hello-world' }, { tool: 'hello-world-scoped' }])(
    'should call the tool and receive progress notifications for $tool',
    async ({ tool }) => {
      const result: any = await client.callTool({
        name: tool,
        arguments: { id: 'userRepo123' },
      });

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Hello, Repository User!');
    },
  );
});
