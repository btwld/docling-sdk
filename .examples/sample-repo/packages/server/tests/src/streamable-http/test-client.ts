// Using built-in fetch API

async function testMcpServer() {
  console.log('Testing MCP server...');

  try {
    // Initialize the connection
    console.log('Initializing connection...');
    const initResponse = await fetch('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {},
      }),
    });

    const initData = await initResponse.json();
    console.log('Initialization response:', initData);

    // List tools
    console.log('\nListing tools...');
    const toolsResponse = await fetch('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tools-1',
        method: 'tools/list',
        params: {},
      }),
    });

    const toolsData = await toolsResponse.json();
    console.log('Tools response:', JSON.stringify(toolsData, null, 2));

    // Call the greet tool
    console.log('\nCalling greet tool...');
    const greetResponse = await fetch('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'greet-1',
        method: 'tools/call',
        params: {
          name: 'greet',
          arguments: {
            name: 'Test User',
          },
        },
      }),
    });

    const greetData = await greetResponse.json();
    console.log('Greet tool response:', greetData);

    // Call the echo tool
    console.log('\nCalling echo tool...');
    const echoResponse = await fetch('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'echo-1',
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: {
            message: 'Hello from test client!',
          },
        },
      }),
    });

    const echoData = await echoResponse.json();
    console.log('Echo tool response:', echoData);

    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Error testing MCP server:', error);
  }
}

testMcpServer();
