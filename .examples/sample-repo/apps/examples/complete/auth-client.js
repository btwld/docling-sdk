// Auth client for testing the complete example server
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const fetch = require('node-fetch');
const readline = require('readline');

// Use node-fetch directly
const fetchWithoutPolyfill = fetch;

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Prompt for user input
const prompt = (question) => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
};

async function main() {
  console.log('Auth MCP Client');
  console.log('==============');
  console.log('');

  // Create client
  const client = new Client(
    {
      name: 'Auth Test Client',
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
  const baseUrl = 'http://localhost:3000';

  // Ask for authentication mode
  const authMode = await prompt(
    'Select authentication mode:\n' +
      '1. Authenticate as a user\n' +
      '2. Test mode (bypass authentication)\n' +
      '3. No authentication\n' +
      'Enter choice (1-3): ',
  );

  let headers = {};
  let username = '';

  if (authMode === '1') {
    // Authenticate as a user
    username = await prompt('Enter username (alice or bob): ');
    const password = await prompt('Enter password (any value): ');

    // Get token from server
    const response = await fetchWithoutPolyfill(`${baseUrl}/auth/login`, {
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

    const data = await response.json();
    const token = data.token;

    console.log(`Authenticated as ${username} with token: ${token}`);
    headers = {
      Authorization: `Bearer ${token}`,
    };
  } else if (authMode === '2') {
    // Test mode
    console.log('Using test mode (bypassing authentication)');
    headers = {
      'X-Test-Mode': 'true',
    };
  } else {
    // No authentication
    console.log('No authentication');
  }

  console.log('Using headers:', headers);

  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
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
        switch (choice) {
          case '1':
            // Call public echo tool
            const message = await prompt('Enter message to echo: ');
            const echoResult = await client.callTool({
              name: 'echo',
              arguments: { message },
            });

            console.log('Echo result:');
            if (echoResult.content && Array.isArray(echoResult.content)) {
              echoResult.content.forEach((content) => {
                if (content.type === 'text') {
                  console.log(content.text);
                }
              });
            }
            break;

          case '2':
            // Call authenticated echo tool
            const authMessage = await prompt(
              'Enter message for authenticated echo: ',
            );
            const authEchoResult = await client.callTool({
              name: 'authenticatedEcho',
              arguments: { message: authMessage },
            });

            console.log('Authenticated echo result:');
            if (
              authEchoResult.content &&
              Array.isArray(authEchoResult.content)
            ) {
              authEchoResult.content.forEach((content) => {
                if (content.type === 'text') {
                  console.log(content.text);
                }
              });
            }
            break;

          case '3':
            // Call admin tool
            const adminResult = await client.callTool({
              name: 'adminTool',
              arguments: {},
            });

            console.log('Admin tool result:');
            if (adminResult.content && Array.isArray(adminResult.content)) {
              adminResult.content.forEach((content) => {
                if (content.type === 'text') {
                  console.log(content.text);
                }
              });
            }
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
    console.log('\nDisconnected from server');
    rl.close();
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
