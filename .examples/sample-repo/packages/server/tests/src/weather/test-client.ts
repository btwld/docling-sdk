// Using built-in fetch API

async function testWeatherServer() {
  console.log('Testing Weather MCP server...');
  
  try {
    // Initialize the connection
    console.log('Initializing connection...');
    const initResponse = await fetch('http://localhost:3000/sse', {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream',
      },
    });
    
    if (!initResponse.ok) {
      console.error('Failed to connect to SSE endpoint:', initResponse.status, initResponse.statusText);
      return;
    }
    
    console.log('SSE connection established');
    
    // List tools
    console.log('\nListing tools...');
    const toolsResponse = await fetch('http://localhost:3000/messages', {
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
    
    // Call the get-weather tool
    console.log('\nCalling get-weather tool...');
    const weatherResponse = await fetch('http://localhost:3000/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'weather-1',
        method: 'tools/call',
        params: {
          name: 'get-weather',
          arguments: {
            location: 'New York',
            units: 'metric',
          },
        },
      }),
    });
    
    const weatherData = await weatherResponse.json();
    console.log('Weather tool response:', JSON.stringify(weatherData, null, 2));
    
    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Error testing Weather MCP server:', error);
  }
}

testWeatherServer();
