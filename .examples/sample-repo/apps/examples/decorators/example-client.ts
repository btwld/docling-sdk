import { McpClient } from '@modelcontextprotocol/sdk/client/mcp.js';
import { StreamableHttpClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Example client that connects to the example server
 */
async function main() {
  // Create a client with the StreamableHTTP transport
  const client = new McpClient(
    new StreamableHttpClientTransport({
      url: 'http://localhost:3000/streamable-http',
    }),
  );

  try {
    // Connect to the server
    console.log('Connecting to server...');
    await client.connect();
    console.log('Connected to server');

    // Get server capabilities
    const capabilities = await client.getCapabilities();
    console.log('Server capabilities:');
    console.log(JSON.stringify(capabilities, null, 2));

    // Test tool capabilities
    console.log('\nTesting tool capabilities:');
    const addResult = await client.callTool('add', { a: 2, b: 3 });
    console.log('add(2, 3) =', addResult.result);

    const multiplyResult = await client.callTool('multiply', { a: 2, b: 3 });
    console.log('multiply(2, 3) =', multiplyResult.result);

    // Test resource capabilities
    console.log('\nTesting resource capabilities:');
    const documents = await client.getResource('documents');
    console.log('Documents:', documents);

    const document = await client.getResource('document/doc1');
    console.log('Document 1:', document);

    // Test prompt capabilities
    console.log('\nTesting prompt capabilities:');
    const greeting = await client.callPrompt('greeting', { name: 'World' });
    console.log('Greeting:', greeting.content);

    const summary = await client.callPrompt('summarize', {
      text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    });
    console.log('Summary:', summary.content);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Disconnect from the server
    await client.disconnect();
    console.log('Disconnected from server');
  }
}

main();
