// Simple client for testing the complete example server
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function main() {
  console.log('Simple MCP Client');
  console.log('================');
  console.log('');

  // Create client
  const client = new Client(
    {
      name: 'Simple Test Client',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Connect to server
  console.log('Connecting to server...');
  // Create transport with test mode header
  const headers = { 'X-Test-Mode': 'true' };
  console.log('Using headers:', headers);

  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost:3000/mcp'),
    {
      requestInit: {
        headers,
      },
    },
  );

  try {
    await client.connect(transport);
    console.log('Connected to server');

    // List tools
    console.log('\nListing tools...');
    const tools = await client.listTools();
    console.log('Available tools:');
    for (const tool of tools.tools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }

    // Call echo tool
    console.log('\nCalling echo tool...');
    const echoResult = await client.callTool({
      name: 'echo',
      arguments: { message: 'Hello, world!' },
    });

    console.log('Echo result:');
    if (echoResult.content && Array.isArray(echoResult.content)) {
      echoResult.content.forEach((content) => {
        if (content.type === 'text') {
          console.log(content.text);
        }
      });
    }

    // Call add tool
    console.log('\nCalling add tool...');
    const addResult = await client.callTool({
      name: 'add',
      arguments: { a: 5, b: 7 },
    });

    console.log('Add result:');
    if (addResult.structuredContent) {
      console.log('Structured content:');
      console.log(JSON.stringify(addResult.structuredContent, null, 2));
    }
    if (addResult.content && Array.isArray(addResult.content)) {
      console.log('Content:');
      addResult.content.forEach((content) => {
        if (content.type === 'text') {
          console.log(content.text);
        }
      });
    }

    // Call authenticated echo tool with test mode header
    console.log('\nCalling authenticatedEcho tool with test mode header...');

    // Create a new transport with test mode header
    const testTransport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/mcp'),
      {
        requestInit: {
          headers: {
            'X-Test-Mode': 'true',
          },
        },
      },
    );

    // Create a new client with test mode
    const testClient = new Client(
      {
        name: 'Test Mode Client',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    try {
      // Connect with test mode
      await testClient.connect(testTransport);
      console.log('Connected with test mode');

      // Call authenticated echo with test mode
      const authEchoResult = await testClient.callTool({
        name: 'authenticatedEcho',
        arguments: { message: 'Hello with test mode auth!' },
      });

      console.log('Authenticated echo result with test mode:');
      if (authEchoResult.content && Array.isArray(authEchoResult.content)) {
        authEchoResult.content.forEach((content) => {
          if (content.type === 'text') {
            console.log(content.text);
          }
        });
      }

      // Close test client
      await testClient.close();
    } catch (error) {
      console.error('Error with test mode:', error);
    }

    // Call admin tool with test mode
    console.log('\nCalling adminTool with test mode...');

    // Create a new transport with test mode header
    const adminTransport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3000/mcp'),
      {
        requestInit: {
          headers: {
            'X-Test-Mode': 'true',
          },
        },
      },
    );

    // Create a new client for admin tool
    const adminClient = new Client(
      {
        name: 'Admin Test Client',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    try {
      // Connect with test mode
      await adminClient.connect(adminTransport);
      console.log('Connected with test mode for admin');

      // Call admin tool with test mode
      const adminResult = await adminClient.callTool({
        name: 'adminTool',
        arguments: {},
      });

      console.log('Admin tool result with test mode:');
      if (adminResult.content && Array.isArray(adminResult.content)) {
        adminResult.content.forEach((content) => {
          if (content.type === 'text') {
            console.log(content.text);
          }
        });
      }

      // Close admin client
      await adminClient.close();
    } catch (error) {
      console.error('Error with admin test mode:', error);
    }

    // Close the connection
    await client.close();
    console.log('\nDisconnected from server');
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
