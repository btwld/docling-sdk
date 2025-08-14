import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Example client for testing structured output
 */
async function main() {
  console.log('Connecting to MCP server...');

  // Create a client with the StreamableHTTP transport
  const client = new Client(
    {
      name: 'Structured Output Test Client',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Connect to the server
  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost:3000/mcp'),
  );

  await client.connect(transport);
  console.log('Connected to MCP server');

  // List available tools
  console.log('\nListing available tools...');
  const tools = await client.listTools();
  console.log('Available tools:');
  for (const tool of tools.tools) {
    console.log(`- ${tool.name}: ${tool.description}`);
    if (tool.outputSchema) {
      console.log('  Has structured output schema');
    }
  }

  // Call the weather tool
  console.log('\nCalling get_weather tool...');
  const weatherResult = await client.callTool({
    name: 'get_weather',
    arguments: {
      city: 'London',
      country: 'UK',
    },
  });

  console.log('\nWeather tool result:');
  if (weatherResult.structuredContent) {
    console.log('Structured content:');
    console.log(JSON.stringify(weatherResult.structuredContent, null, 2));
  }

  if (weatherResult.content && Array.isArray(weatherResult.content)) {
    console.log('Unstructured content:');
    weatherResult.content.forEach((content) => {
      if (content.type === 'text') {
        console.log(content.text);
      }
    });
  }

  // Call the forecast tool
  console.log('\nCalling get_forecast tool...');
  const forecastResult = await client.callTool({
    name: 'get_forecast',
    arguments: {
      city: 'New York',
      country: 'US',
      days: 5,
    },
  });

  console.log('\nForecast tool result:');
  if (forecastResult.structuredContent) {
    console.log('Structured content:');
    console.log(JSON.stringify(forecastResult.structuredContent, null, 2));
  }

  // Close the connection
  await client.close();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
