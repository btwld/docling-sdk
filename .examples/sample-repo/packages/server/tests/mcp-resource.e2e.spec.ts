import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { McpModule, Resource, McpTransportType } from '../src';
import { createMCPClient } from './utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

@Injectable()
export class GreetingToolResource {
  constructor() {}

  @Resource({
    name: 'hello-world',
    description: 'A simple greeting resource',
    mimeType: 'text/plain',
    uri: 'mcp://hello-world',
  })
  sayHello({ uri }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: 'Hello World',
        },
      ],
    };
  }

  @Resource({
    name: 'hello-world-dynamic',
    description: 'A simple greeting dynamic resource',
    mimeType: 'text/plain',
    uri: 'mcp://hello-world-dynamic/{userName}',
  })
  sayHelloDynamic({ uri, userName }) {
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'text/plain',
          text: `Hello ${userName}`,
        },
      ],
    };
  }

  @Resource({
    name: 'hello-world-dynamic-multiple-paths',
    description: 'A simple greeting dynamic resource with multiple paths',
    mimeType: 'text/plain',
    uri: 'mcp://hello-world-dynamic-multiple-paths/{userId}/{userName}',
  })
  sayHelloMultiplePathsDynamic({ uri, userId, userName }) {
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'text/plain',
          text: `Hello ${userName} from ${userId}`,
        },
      ],
    };
  }
}

describe('E2E: MCP Resource Server', () => {
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
      providers: [GreetingToolResource],
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

  it('should list resources', async () => {
    const resources = await client.listResources();

    const helloWorldResource = resources.resources.find(
      (r: any) => r.name === 'hello-world',
    );
    expect(helloWorldResource).toMatchObject({
      name: 'hello-world',
      uri: 'mcp://hello-world',
      description: 'A simple greeting resource',
      mimeType: 'text/plain',
    });

    const dynamicResource = resources.resources.find(
      (r: any) => r.name === 'hello-world-dynamic',
    );
    expect(dynamicResource).toMatchObject({
      name: 'hello-world-dynamic',
      uri: 'mcp://hello-world-dynamic/{userName}',
      description: 'A simple greeting dynamic resource',
      mimeType: 'text/plain',
    });
  });

  it('should call the dynamic resource', async () => {
    const result: any = await client.readResource({
      uri: 'mcp://hello-world-dynamic/Raphael_John',
    });

    expect(result.contents[0].uri).toBe(
      'mcp://hello-world-dynamic/Raphael_John',
    );
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect(result.contents[0].text).toBe('Hello Raphael_John');
  });

  it('should call the dynamic resource with multiple paths', async () => {
    const result: any = await client.readResource({
      uri: 'mcp://hello-world-dynamic-multiple-paths/123/Raphael_John',
    });

    expect(result.contents[0].uri).toBe(
      'mcp://hello-world-dynamic-multiple-paths/123/Raphael_John',
    );
    expect(result.contents[0].mimeType).toBe('text/plain');
    expect(result.contents[0].text).toBe('Hello Raphael_John from 123');
  });
});
