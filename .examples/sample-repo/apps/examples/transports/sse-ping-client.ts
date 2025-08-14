import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function testSsePingClient() {
  console.log('Testing SSE ping client...');

  try {
    // Create a transport with the server URL
    const transport = new SSEClientTransport(
      new URL('http://localhost:3003/sse'),
      {
        requestInit: {
          headers: {
            Accept: 'text/event-stream',
          },
        },
      },
    );

    console.log('Created SSE transport');

    // Create a client with the transport
    const client = new Client({
      name: 'ping-test-client',
      version: '1.0.0',
      logLevel: 'debug',
    });

    // Connect to the server
    console.log('Connecting to SSE MCP server...');
    await client.connect(transport);
    console.log('Connected to SSE MCP server successfully!');

    // Send a ping request
    console.log('Sending ping request...');

    // Use the ping method to send a ping request
    const pingResponse = await client.ping();

    console.log('Ping response:', JSON.stringify(pingResponse, null, 2));

    // Close the connection
    await client.close();
    console.log('Connection closed');

    console.log('SSE ping test completed successfully!');
  } catch (error) {
    console.error('SSE ping test failed with error:', error);
  }
}

// Run the test
testSsePingClient();
