import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';

async function runTest() {
  console.log('Starting MCP StreamableHTTP client test...');
  
  try {
    // Create a transport with the server URL
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/mcp')
    );
    
    console.log('Connecting to MCP server...');
    
    // Create a client with the transport
    const client = new Client(transport);
    
    // Connect to the server
    await client.connect();
    console.log('Connected to MCP server successfully!');
    
    // List available tools
    console.log('Listing available tools...');
    const tools = await client.listTools();
    console.log('Available tools:', tools);
    
    // Call the greet tool if available
    if (tools.tools.some(tool => tool.name === 'greet')) {
      console.log('Calling greet tool...');
      const result = await client.callTool('greet', { name: 'Test User' });
      console.log('Greet tool result:', result);
    } else {
      console.log('Greet tool not found, skipping tool call test');
    }
    
    // Test reconnection with resumability
    console.log('Testing reconnection with resumability...');
    let lastResumptionToken: string | undefined;
    
    // Send a message with resumption token handling
    await transport.send(
      { jsonrpc: '2.0', method: 'tools/list', params: {}, id: 'test-resumption' },
      {
        onresumptiontoken: (token) => {
          console.log('Received resumption token:', token);
          lastResumptionToken = token;
        }
      }
    );
    
    // Simulate reconnection
    if (lastResumptionToken) {
      console.log('Simulating reconnection with token:', lastResumptionToken);
      await transport.send(
        { jsonrpc: '2.0', method: 'tools/list', params: {}, id: 'test-reconnect' },
        {
          resumptionToken: lastResumptionToken
        }
      );
      console.log('Reconnection successful!');
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
runTest();
