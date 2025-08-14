// Direct auth client for testing the complete example server
const fetch = require('node-fetch').default;
const readline = require('readline');

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
  console.log('Direct Auth Client');
  console.log('=================');
  console.log('');

  const baseUrl = 'http://localhost:3000';

  // Ask for authentication mode
  const authMode = await prompt(
    'Select authentication mode:\n' +
      '1. Authenticate as a regular user (alice)\n' +
      '2. Authenticate as an admin user (bob)\n' +
      '3. Test mode (bypass authentication)\n' +
      '4. No authentication\n' +
      'Enter choice (1-4): ',
  );

  let headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  let username = '';

  if (authMode === '1' || authMode === '2') {
    // Authenticate as a user
    username = authMode === '1' ? 'alice' : 'bob';
    const password = 'password'; // Any password works for the demo

    console.log(`Authenticating as ${username}...`);

    // Get token from server
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
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
      ...headers,
      Authorization: `Bearer ${token}`,
    };
  } else if (authMode === '3') {
    // Test mode
    console.log('Using test mode (bypassing authentication)');
    headers = {
      ...headers,
      'X-Test-Mode': 'true',
    };
  } else {
    // No authentication
    console.log('No authentication');
  }

  console.log('Using headers:', headers);

  try {
    // Initialize the MCP session
    console.log('\nInitializing MCP session...');
    const initResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'init',
        method: 'mcp/initialize',
        params: {
          client: {
            name: 'Direct Auth Client',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
        },
      }),
    });

    if (!initResponse.ok) {
      console.error('Initialization failed:', await initResponse.text());
      return;
    }

    const initResult = await initResponse.json();
    console.log('Initialization result:', JSON.stringify(initResult, null, 2));

    // Test public echo tool
    console.log('\nTesting public echo tool...');
    const echoResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { message: 'Hello, world!' },
        },
      }),
    });

    if (!echoResponse.ok) {
      console.error('Echo request failed:', await echoResponse.text());
    } else {
      const echoResult = await echoResponse.json();
      console.log('Echo result:', JSON.stringify(echoResult, null, 2));
    }

    // Test authenticated echo tool
    console.log('\nTesting authenticated echo tool...');
    const authEchoResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '2',
        method: 'tools/call',
        params: {
          name: 'authenticatedEcho',
          arguments: { message: 'Hello with auth!' },
        },
      }),
    });

    if (!authEchoResponse.ok) {
      console.error(
        'Authenticated echo request failed:',
        await authEchoResponse.text(),
      );
    } else {
      const authEchoResult = await authEchoResponse.json();
      console.log(
        'Authenticated echo result:',
        JSON.stringify(authEchoResult, null, 2),
      );
    }

    // Test admin tool
    console.log('\nTesting admin tool...');
    const adminResponse = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '3',
        method: 'tools/call',
        params: {
          name: 'adminTool',
          arguments: {},
        },
      }),
    });

    if (!adminResponse.ok) {
      console.error('Admin tool request failed:', await adminResponse.text());
    } else {
      const adminResult = await adminResponse.json();
      console.log('Admin tool result:', JSON.stringify(adminResult, null, 2));
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    rl.close();
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
