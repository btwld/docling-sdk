// We'll use the browser WebSocket API
import WebSocket from 'ws';

// Create a unique ID for each request
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

// Main function to test the WebSocket client
async function testWebSocketClient() {
  console.log('Starting WebSocket client test...');

  // Connect to the WebSocket server
  console.log('Connecting to WebSocket server...');
  const ws = new WebSocket('ws://localhost:3001/ws');

  // Handle connection events
  ws.onopen = () => {
    console.log('Connected to WebSocket server!');

    // Initialize the connection
    const initializeId = generateId();
    ws.send(
      JSON.stringify({
        event: 'initialize',
        data: {
          jsonrpc: '2.0',
          id: initializeId,
          method: 'initialize',
          params: {},
        },
      }),
    );
  };

  // Handle messages
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data.toString());
    console.log('Received message:', message);

    if (message.event === 'initialize') {
      console.log('Server info:', message.data.result);

      // Call the greet tool
      callGreetTool(ws);
    } else if (message.event === 'result') {
      if (message.data.result.content[0].text.includes('Hello')) {
        console.log('Greet tool result:', message.data.result);

        // Call the echo tool
        callEchoTool(ws);
      } else if (
        message.data.result.content[0].text.includes(
          'Hello from WebSocket client',
        )
      ) {
        console.log('Echo tool result:', message.data.result);

        // Test notifications
        testNotifications(ws);
      }
    } else if (message.event === 'notification') {
      console.log('Notification received:', message);

      // Close the connection
      console.log('All tests completed successfully!');
      ws.close();
    }
  };

  // Handle errors
  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  // Handle disconnection
  ws.onclose = () => {
    console.log('Disconnected from WebSocket server');
  };
}

// Function to call the greet tool
function callGreetTool(ws) {
  console.log('Calling greet tool...');
  const greetId = generateId();

  ws.send(
    JSON.stringify({
      event: 'call',
      data: {
        jsonrpc: '2.0',
        id: greetId,
        method: 'greet',
        params: { name: 'WebSocket User' },
      },
    }),
  );
}

// Function to call the echo tool
function callEchoTool(ws) {
  console.log('Calling echo tool...');
  const echoId = generateId();

  ws.send(
    JSON.stringify({
      event: 'call',
      data: {
        jsonrpc: '2.0',
        id: echoId,
        method: 'echo',
        params: { message: 'Hello from WebSocket client!' },
      },
    }),
  );
}

// Function to test notifications
function testNotifications(ws) {
  console.log('Testing notifications...');

  // Send a notification
  ws.send(
    JSON.stringify({
      event: 'notify',
      data: {
        jsonrpc: '2.0',
        method: 'test-notification',
        params: { message: 'This is a test notification' },
      },
    }),
  );
}

// Run the test
testWebSocketClient();
