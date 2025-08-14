import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fetch from 'node-fetch';
import readline from 'readline';

// Polyfill fetch for Node.js
// @ts-ignore
global.fetch = fetch;

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Prompt for user input
const prompt = (question: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

/**
 * Main function
 */
async function main() {
  console.log('Complete Example MCP Client');
  console.log('==========================');
  console.log('');

  // Ask for transport type
  // For simplicity, we'll use only the StreamableHTTP transport
  const baseUrl = 'http://localhost:3000';
  const transportName = 'StreamableHTTP';
  let transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));

  // Ask for authentication mode
  const authMode = await prompt(
    'Select authentication mode:\n' +
      '1. Authenticate as a user\n' +
      '2. Test mode (bypass authentication)\n' +
      '3. No authentication\n' +
      'Enter choice (1-3): ',
  );

  let headers: Record<string, string> = {};
  let username = '';

  if (authMode === '1') {
    // Authenticate as a user
    username = await prompt('Enter username (alice or bob): ');
    const password = await prompt('Enter password (any value): ');

    // Get token from server
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      console.error('Authentication failed:', await response.text());
      rl.close();
      return;
    }

    const data = (await response.json()) as { token: string };
    const token = data.token;

    console.log(`Authenticated as ${username} with token: ${token}`);
    headers = {
      Authorization: `Bearer ${token}`,
    };
  } else if (authMode === '2') {
    // Test mode
    console.log('Using test mode (bypassing authentication)');
    headers = {
      'x-test-mode': 'true',
    };
    username = 'alice (test mode)';
  } else {
    // No authentication
    console.log('No authentication provided');
    username = 'anonymous';
  }

  // Create client
  const client = new Client(
    {
      name: 'Complete Example Client',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: { subscribe: true },
        completions: {},
      },
    },
  );

  // Set headers for transport
  transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers,
    },
  });

  try {
    console.log(`Connecting to ${transportName} server at ${baseUrl}...`);
    await client.connect(transport);
    console.log('Connected to MCP server');

    // Interactive testing
    while (true) {
      console.log('\nAvailable actions:');
      console.log('1. List tools');
      console.log('2. Call a tool');
      console.log('3. List prompts');
      console.log('4. Get a prompt');
      console.log('5. List resources');
      console.log('6. Read a resource');
      console.log('7. Subscribe to a resource');
      console.log('8. Unsubscribe from a resource');
      console.log('9. Exit');

      const choice = await prompt('Enter choice (1-9): ');

      if (choice === '9') {
        break;
      }

      try {
        switch (choice) {
          case '1':
            // List tools
            const tools = await client.listTools();
            console.log('\nAvailable tools:');
            for (const tool of tools.tools) {
              console.log(`- ${tool.name}: ${tool.description}`);
            }
            break;

          case '2':
            // Call a tool
            const toolName = await prompt('Enter tool name: ');
            const toolArgs = await prompt('Enter tool arguments (JSON): ');
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(toolArgs);
            } catch (error) {
              console.error('Invalid JSON arguments, using empty object');
            }

            const toolResult = await client.callTool({
              name: toolName,
              arguments: parsedArgs,
            });

            console.log('\nTool result:');
            if (toolResult.structuredContent) {
              console.log('Structured content:');
              console.log(
                JSON.stringify(toolResult.structuredContent, null, 2),
              );
            }

            if (toolResult.content && Array.isArray(toolResult.content)) {
              console.log('Content:');
              toolResult.content.forEach((content) => {
                if (content.type === 'text') {
                  console.log(content.text);
                } else if (content.type === 'image') {
                  console.log('[Image data]');
                } else if (content.type === 'resource') {
                  console.log(`[Resource: ${content.resource.uri}]`);
                }
              });
            }
            break;

          case '3':
            // List prompts
            const prompts = await client.listPrompts();
            console.log('\nAvailable prompts:');
            for (const prompt of prompts.prompts) {
              console.log(`- ${prompt.name}: ${prompt.description}`);
              if (prompt.arguments && prompt.arguments.length > 0) {
                console.log('  Arguments:');
                for (const arg of prompt.arguments) {
                  console.log(
                    `  - ${arg.name}${arg.required ? ' (required)' : ''}: ${arg.description}`,
                  );
                }
              }
            }
            break;

          case '4':
            // Get a prompt
            const promptName = await prompt('Enter prompt name: ');
            const promptArgs = await prompt('Enter prompt arguments (JSON): ');
            let parsedPromptArgs = {};
            try {
              parsedPromptArgs = JSON.parse(promptArgs);
            } catch (error) {
              console.error('Invalid JSON arguments, using empty object');
            }

            const promptResult = await client.getPrompt({
              name: promptName,
              arguments: parsedPromptArgs,
            });

            console.log('\nPrompt result:');
            if (promptResult.messages && Array.isArray(promptResult.messages)) {
              for (const message of promptResult.messages) {
                console.log(`[${message.role}]:`);
                if (message.content.type === 'text') {
                  console.log(message.content.text);
                } else if (message.content.type === 'image') {
                  console.log('[Image data]');
                } else if (message.content.type === 'resource') {
                  console.log(`[Resource: ${message.content.resource.uri}]`);
                }
                console.log('');
              }
            }
            break;

          case '5':
            // List resources
            const resources = await client.listResources();
            console.log('\nAvailable resources:');
            for (const resource of resources.resources) {
              console.log(
                `- ${resource.uri}: ${resource.name} (${resource.mimeType})`,
              );
            }

            if (resources.nextCursor) {
              console.log(
                `\nMore resources available. Next cursor: ${resources.nextCursor}`,
              );
            }
            break;

          case '6':
            // Read a resource
            const resourceUri = await prompt('Enter resource URI: ');
            const resourceResult = await client.readResource({
              uri: resourceUri,
            });

            console.log('\nResource content:');
            if (
              resourceResult.contents &&
              Array.isArray(resourceResult.contents)
            ) {
              for (const content of resourceResult.contents) {
                console.log(`URI: ${content.uri}`);
                console.log(`Name: ${content.name}`);
                console.log(`MIME Type: ${content.mimeType}`);
                if (content.text) {
                  console.log(`Content: ${content.text}`);
                } else if (content.blob) {
                  console.log('Content: [Binary data]');
                }
              }
            }
            break;

          case '7':
            // Subscribe to a resource
            const subUri = await prompt('Enter resource URI to subscribe to: ');
            // Use custom request for subscribe since it's not directly exposed in the client
            await (client as any).request({
              method: 'resources/subscribe',
              params: { uri: subUri },
            });
            console.log(`Subscribed to resource: ${subUri}`);
            break;

          case '8':
            // Unsubscribe from a resource
            const unsubUri = await prompt(
              'Enter resource URI to unsubscribe from: ',
            );
            // Use custom request for unsubscribe since it's not directly exposed in the client
            await (client as any).request({
              method: 'resources/unsubscribe',
              params: { uri: unsubUri },
            });
            console.log(`Unsubscribed from resource: ${unsubUri}`);
            break;

          default:
            console.log('Invalid choice');
        }
      } catch (error) {
        console.error('Error:', error);
      }
    }
  } catch (error) {
    console.error('Error connecting to server:', error);
  } finally {
    // Close the client
    await client.close();
    console.log('Disconnected from server');
    rl.close();
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
