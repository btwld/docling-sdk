import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function testStreamableHttpClient() {
  console.log('Testing StreamableHTTP client...');

  try {
    // Create a transport with the server URL
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3001/mcp'),
    );

    // Create a client with the transport
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    // Connect to the server
    await client.connect(transport);
    console.log('Connected to StreamableHTTP MCP server successfully!');

    // List available tools
    console.log('Listing available tools...');
    const tools = await client.listTools();
    console.log('Available tools:', JSON.stringify(tools, null, 2));

    // Call the greet tool if available
    if (tools.tools.some((tool) => tool.name === 'greet')) {
      console.log('Calling greet tool...');
      const result = await client.callTool({
        name: 'greet',
        arguments: {
          name: 'StreamableHTTP User',
        },
      });
      console.log('Greet tool result:', JSON.stringify(result, null, 2));
    } else {
      console.log('Greet tool not found, skipping tool call test');
    }

    // Close the connection
    await client.close();
    console.log('Connection closed');

    console.log('StreamableHTTP test completed successfully!');
  } catch (error) {
    console.error('StreamableHTTP test failed with error:', error);
  }
}

// Run the test
testStreamableHttpClient();
