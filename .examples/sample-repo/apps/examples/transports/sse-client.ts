import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function testSseClient() {
  console.log('Testing SSE client...');

  try {
    // Create a transport with the server URL
    // The URL must match exactly what the server expects
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

    // Enable console logging for debugging
    console.log('Created SSE transport');

    // Create a client with the transport and verbose logging
    const client = new Client({
      name: 'test-client',
      version: '1.0.0',
      logLevel: 'debug',
    });

    // Connect to the server with a timeout
    console.log('Connecting to SSE MCP server...');

    try {
      // Add detailed debug logging for the transport
      transport.onerror = (error) => {
        console.error('Transport error:', error);
        if (error instanceof Error) {
          console.error('Error stack:', error.stack);
        }
      };

      transport.onclose = () => {
        console.log('Transport closed');
      };

      transport.onmessage = (message) => {
        console.log('Transport message:', JSON.stringify(message, null, 2));
      };

      // Add event listener to the EventSource for debugging
      // @ts-ignore - Access private property for debugging
      const eventSource = transport['_eventSource'];
      if (eventSource) {
        console.log('Adding event listeners to EventSource');

        eventSource.addEventListener('open', (event: Event) => {
          console.log('EventSource open event:', event);
          console.log('EventSource readyState:', eventSource.readyState);
        });

        eventSource.addEventListener('error', (event: Event) => {
          console.error('EventSource error event:', event);
          console.error('EventSource readyState:', eventSource.readyState);
        });

        eventSource.addEventListener('endpoint', (event: Event) => {
          console.log('EventSource endpoint event:', event);
          // Cast to MessageEvent to access data property
          const messageEvent = event as MessageEvent;
          console.log('Endpoint data:', messageEvent.data);

          // Print the session ID
          const url = new URL(messageEvent.data, 'http://localhost:3003');
          const sessionId = url.searchParams.get('sessionId');
          console.log('Session ID:', sessionId);

          // Print the full endpoint URL
          console.log('Full endpoint URL:', url.href);
        });

        eventSource.addEventListener('message', (event: Event) => {
          console.log('EventSource message event:', event);
          // Cast to MessageEvent to access data property
          const messageEvent = event as MessageEvent;
          console.log('Message data:', messageEvent.data);

          try {
            const jsonData = JSON.parse(messageEvent.data);
            console.log(
              'Parsed message data:',
              JSON.stringify(jsonData, null, 2),
            );

            // Check if this is a notification
            if (
              jsonData.method &&
              jsonData.method.startsWith('notifications/')
            ) {
              console.log('Received notification:', jsonData.method);
              console.log(
                'Notification params:',
                JSON.stringify(jsonData.params, null, 2),
              );
            }
          } catch (error) {
            console.log('Message data is not valid JSON');
          }
        });

        // Add listener for handshake event
        eventSource.addEventListener('mcp/handshake', (event: Event) => {
          console.log('EventSource mcp/handshake event:', event);
          // Cast to MessageEvent to access data property
          const messageEvent = event as MessageEvent;
          console.log('Handshake data:', messageEvent.data);
        });
      }

      // @ts-ignore - Access private property for debugging
      console.log('Transport endpoint:', transport['_endpoint']?.href);

      const connectPromise = client.connect(transport);

      // Set a timeout for the connection
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout')), 30000);
      });

      await Promise.race([connectPromise, timeoutPromise]);
      console.log('Connected to SSE MCP server successfully!');
    } catch (error) {
      console.error('Failed to connect to SSE MCP server:', error);
      throw error;
    }

    // List available tools
    console.log('Listing available tools...');
    const tools = await client.listTools({}, { timeout: 15000 });
    console.log('Available tools:', JSON.stringify(tools, null, 2));

    // Call the greet tool if available
    if (tools.tools.some((tool) => tool.name === 'greet')) {
      console.log('Calling greet tool...');
      const result = await client.callTool(
        {
          name: 'greet',
          arguments: { name: 'SSE User' },
        },
        undefined,
        { timeout: 15000 },
      );
      console.log('Greet tool result:', JSON.stringify(result, null, 2));
    } else {
      console.log('Greet tool not found, skipping tool call test');
    }

    // List available resources
    console.log('Listing available resources...');
    try {
      const resources = await client.listResources({}, { timeout: 15000 });
      console.log('Available resources:', JSON.stringify(resources, null, 2));

      // Read a resource if available
      if (resources.resources && resources.resources.length > 0) {
        const resourceUri = resources.resources[0].uri;
        console.log(`Reading resource: ${resourceUri}`);
        const resourceContent = await client.readResource(
          { uri: resourceUri },
          { timeout: 15000 },
        );
        console.log(
          'Resource content:',
          JSON.stringify(resourceContent, null, 2),
        );
      } else {
        console.log('No resources found, skipping resource read test');
      }
    } catch (error) {
      console.error('Error listing or reading resources:', error);
    }

    // List available prompts
    console.log('Listing available prompts...');
    try {
      const prompts = await client.listPrompts({}, { timeout: 15000 });
      console.log('Available prompts:', JSON.stringify(prompts, null, 2));

      // Get a prompt if available
      if (prompts.prompts && prompts.prompts.length > 0) {
        const promptName = prompts.prompts[0].name;
        console.log(`Getting prompt: ${promptName}`);
        const promptContent = await client.getPrompt(
          {
            name: promptName,
            arguments: {
              style: 'casual',
              temperature: '0.7',
            },
          },
          { timeout: 15000 },
        );
        console.log('Prompt content:', JSON.stringify(promptContent, null, 2));
      } else {
        console.log('No prompts found, skipping prompt get test');
      }
    } catch (error) {
      console.error('Error listing or getting prompts:', error);
    }

    // Close the connection
    await client.close();
    console.log('Connection closed');

    console.log('SSE test completed successfully!');
  } catch (error) {
    console.error('SSE test failed with error:', error);
  }
}

// Run the test
testSseClient();
