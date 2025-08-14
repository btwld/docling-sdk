import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fetch from 'node-fetch';
import readline from 'readline';

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
  console.log('MCP Auth Integration Client');
  console.log('==========================');
  console.log('');

  // Ask for authentication mode
  const authMode = await prompt(
    'Select authentication mode:\n' +
    '1. Authenticate as a regular user (alice)\n' +
    '2. Authenticate as an admin user (bob)\n' +
    '3. No authentication\n' +
    'Enter choice (1-3): '
  );

  let headers: Record<string, string> = {};
  let username = '';

  if (authMode === '1' || authMode === '2') {
    // Authenticate as a user
    username = authMode === '1' ? 'alice' : 'bob';
    const password = 'password123'; // Default password for demo

    console.log(`Authenticating as ${username}...`);

    // Get token from server
    const response = await fetch('http://localhost:3000/auth/login', {
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

    const data = await response.json() as { access_token: string; user: any };
    const token = data.access_token;

    console.log(`Authenticated as ${username} with token: ${token}`);
    console.log('User info:', data.user);
    
    headers = {
      Authorization: `Bearer ${token}`,
    };
  } else {
    // No authentication
    console.log('No authentication provided');
    username = 'anonymous';
  }

  // Create client
  const client = new Client(
    {
      name: 'Auth Integration Client',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Connect to server
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
    console.log('Connected to MCP server');

    // List available tools
    console.log('\nListing available tools...');
    const tools = await client.listTools();
    console.log('Available tools:');
    for (const tool of tools.tools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }

    // Interactive tool testing
    while (true) {
      console.log('\nAvailable actions:');
      console.log('1. Call publicEcho tool');
      console.log('2. Call authenticatedEcho tool (requires auth)');
      console.log('3. Call adminTool (requires admin role)');
      console.log('4. Exit');

      const choice = await prompt('Enter choice (1-4): ');

      if (choice === '4') {
        break;
      }

      try {
        let result: any;
        switch (choice) {
          case '1':
            const message = await prompt('Enter message to echo: ');
            result = await client.callTool({
              name: 'publicEcho',
              arguments: { message },
            });
            break;
          case '2':
            const authMessage = await prompt('Enter message for authenticated echo: ');
            result = await client.callTool({
              name: 'authenticatedEcho',
              arguments: { message: authMessage },
            });
            break;
          case '3':
            result = await client.callTool({
              name: 'adminTool',
              arguments: {},
            });
            break;
          default:
            console.log('Invalid choice');
            continue;
        }

        console.log('\nTool result:');
        if (result.content && Array.isArray(result.content)) {
          result.content.forEach((content: any) => {
            if (content.type === 'text') {
              console.log(content.text);
            }
          });
        } else {
          console.log(result);
        }
      } catch (error) {
        console.error('Error calling tool:', error);
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
