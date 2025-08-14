async function runTest() {
  console.log('Starting MCP StreamableHTTP client test...');
  
  try {
    const serverUrl = 'http://localhost:3000/mcp';
    
    console.log('Connecting to MCP server...');
    
    // Initialize the connection
    const initResponse = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          clientInfo: { name: 'Test Client', version: '1.0.0' },
          protocolVersion: '2025-03-26'
        },
        id: 'init-1'
      })
    });
    
    if (!initResponse.ok) {
      throw new Error(`Failed to initialize: ${initResponse.status} ${initResponse.statusText}`);
    }
    
    const initResult = await initResponse.json();
    console.log('Connected to MCP server successfully!');
    console.log('Server info:', initResult.result.serverInfo);
    
    // List available tools
    console.log('Listing available tools...');
    const toolsResponse = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 'tools-1'
      })
    });
    
    if (!toolsResponse.ok) {
      throw new Error(`Failed to list tools: ${toolsResponse.status} ${toolsResponse.statusText}`);
    }
    
    const toolsResult = await toolsResponse.json();
    console.log('Available tools:', toolsResult.result.tools);
    
    // Call the greet tool
    console.log('Calling greet tool...');
    const greetResponse = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'greet',
          arguments: { name: 'Test User' }
        },
        id: 'greet-1'
      })
    });
    
    if (!greetResponse.ok) {
      throw new Error(`Failed to call greet tool: ${greetResponse.status} ${greetResponse.statusText}`);
    }
    
    const greetResult = await greetResponse.json();
    console.log('Greet tool result:', greetResult.result);
    
    // Call the echo tool
    console.log('Calling echo tool...');
    const echoResponse = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { message: 'Hello from StreamableHTTP client!' }
        },
        id: 'echo-1'
      })
    });
    
    if (!echoResponse.ok) {
      throw new Error(`Failed to call echo tool: ${echoResponse.status} ${echoResponse.statusText}`);
    }
    
    const echoResult = await echoResponse.json();
    console.log('Echo tool result:', echoResult.result);
    
    // Test SSE connection
    console.log('Testing SSE connection...');
    const sseResponse = await fetch(serverUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream'
      }
    });
    
    if (!sseResponse.ok) {
      throw new Error(`Failed to establish SSE connection: ${sseResponse.status} ${sseResponse.statusText}`);
    }
    
    console.log('SSE connection established successfully!');
    
    // Read one event from the SSE stream
    const reader = sseResponse.body?.getReader();
    if (reader) {
      const { value, done } = await reader.read();
      if (!done) {
        const text = new TextDecoder().decode(value);
        console.log('Received SSE event:', text);
      }
      await reader.cancel();
    }
    
    console.log('All tests completed successfully!');
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
runTest();
