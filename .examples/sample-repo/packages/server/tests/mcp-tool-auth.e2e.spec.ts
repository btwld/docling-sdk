import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Context, Tool, McpModule, McpTransportType } from '../src';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { createMCPClient } from './utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (request.headers['x-test-mode'] === 'true') {
      request.user = {
        id: 'test123',
        name: 'Test User',
        orgMemberships: [
          {
            orgId: 'org123',
            organization: {
              name: 'Auth Test Org',
            },
          },
        ],
      };
      return true;
    }

    if (
      request.headers.authorization &&
      request.headers.authorization.includes('token-xyz')
    ) {
      request.user = {
        id: 'user123',
        name: 'Test User',
        orgMemberships: [
          {
            orgId: 'org123',
            organization: {
              name: 'Auth Test Org',
            },
          },
        ],
      };

      return true;
    }

    return false;
  }
}

@Injectable()
class MockUserRepository {
  async findOne() {
    return Promise.resolve({
      id: 'userRepo123',
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
export class AuthGreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'auth-hello-world',
    description: 'A sample tool that accesses the authenticated user',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context, request: any) {
    try {
      const repoUser = await this.userRepository.findOne();

      if (!request || !request.user) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: No authenticated user found in request`,
            },
          ],
        };
      }

      const authUser = request.user;

      const greeting = `Hello, ${name}! I'm ${authUser.name} from ${authUser.orgMemberships[0].organization.name}. Repository user is ${repoUser.name}.`;

      return {
        content: [
          {
            type: 'text',
            text: greeting,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error in auth-hello-world tool: ${error.message}`,
          },
        ],
      };
    }
  }
}

describe('E2E: MCP Server Tool with Authentication', () => {
  let app: INestApplication;
  let testPort: number;
  let client: Client;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          transport: McpTransportType.STREAMABLE_HTTP,
          name: 'test-auth-mcp-server',
          version: '0.0.1',
          guards: [MockAuthGuard],
          capabilities: {
            tools: {
              'auth-hello-world': {
                description:
                  'A sample tool that accesses the authenticated user',
                input: {
                  name: {
                    type: 'string',
                    default: 'World',
                  },
                },
              },
            },
          },
          streamableHttp: {
            endpoint: 'mcp',
            enableResumability: true,
            statelessMode: true,
          },
        }),
      ],
      providers: [AuthGreetingTool, MockUserRepository, MockAuthGuard],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;

    client = await createMCPClient(testPort, {
      requestInit: {
        headers: {
          Authorization: 'Bearer token-xyz',
        },
      },
    });
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
    expect(
      tools.tools.find((t: { name: string }) => t.name === 'auth-hello-world'),
    ).toBeDefined();
  });

  it('should reject unauthenticated connections', () => {
    const mockGuard = new MockAuthGuard();
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            authorization: 'Bearer invalid-token',
          },
        }),
      }),
    } as ExecutionContext;

    const result = mockGuard.canActivate(mockContext);
    expect(result).toBe(false);
  });
});
