import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function runTest() {
  console.log('Starting MCP StreamableHTTP client test with SDK...');

  try {
    // Create a transport with the server URL
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/mcp'),
    );

    console.log('Connecting to MCP server...');

    // Create a client
    const client = new Client({
      name: 'MCP Test Client',
      version: '1.0.0',
    });

    // Connect to the server with the transport
    await client.connect(transport);
    console.log('Connected to MCP server successfully!');

    // List available tools
    console.log('Listing available tools...');
    const tools = await client.listTools();
    console.log('Available tools:', tools);

    // Call the greet tool if available
    if (tools.tools.some((tool) => tool.name === 'greet')) {
      console.log('Calling greet tool...');
      const result = await client.callTool({
        name: 'greet',
        arguments: { name: 'Test User' },
      });
      console.log('Greet tool result:', result);
    } else {
      console.log('Greet tool not found, skipping tool call test');
    }

    // Call the echo tool if available
    if (tools.tools.some((tool) => tool.name === 'echo')) {
      console.log('Calling echo tool...');
      const result = await client.callTool({
        name: 'echo',
        arguments: { message: 'Hello from SDK client!' },
      });
      console.log('Echo tool result:', result);
    } else {
      console.log('Echo tool not found, skipping tool call test');
    }

    // Close the connection
    await client.close();
    console.log('Connection closed');

    console.log('All tests completed successfully!');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
runTest().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
