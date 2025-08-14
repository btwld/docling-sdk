import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Creates a connected MCP Client instance
 * @param port The port number to connect to
 * @param options Optional configuration options
 * @returns A connected MCP Client instance
 *
 * @example
 * ```typescript
 * const client = await createMCPClient(3000);
 * const tools = await client.listTools();
 * await client.close();
 * ```
 */
export async function createMCPClient(
  port: number,
  options?: {
    requestInit?: RequestInit;
    eventSourceInit?: EventSourceInit;
    authProvider?: any;
  },
): Promise<Client> {
  const mcpUrl = new URL(`http://localhost:${port}/mcp`);

  // Add test mode header for testing
  const testOptions = {
    ...options,
    requestInit: {
      ...options?.requestInit,
      headers: {
        ...options?.requestInit?.headers,
        'x-test-mode': 'true',
        'mcp-session-id': 'test-session-id', // Add a fixed session ID for tests
      },
    },
  };

  const transport = new StreamableHTTPClientTransport(mcpUrl, testOptions);
  const client = new Client({ name: 'test-client', version: '1.0.0' });

  try {
    // Connect the client directly - the SDK will handle initialization
    await client.connect(transport);
    return client;
  } catch (error) {
    console.error('Error creating MCP client:', error);
    throw error;
  }
}
