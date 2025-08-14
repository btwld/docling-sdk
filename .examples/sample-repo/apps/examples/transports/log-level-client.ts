import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

// Define a type for notification messages
interface NotificationMessage {
  jsonrpc: '2.0';
  method: string;
  params: {
    level?: string;
    data?: any;
    [key: string]: any;
  };
}

async function testLogLevelClient() {
  console.log('Testing log level client...');

  try {
    // Create a transport with the server URL
    const transport = new StreamableHTTPClientTransport(
      new URL('http://localhost:3001/mcp'),
    );

    // Create a client with the transport
    const client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });

    // Connect to the server
    console.log('Connecting to StreamableHTTP MCP server...');
    await client.connect(transport);
    console.log('Connected to StreamableHTTP MCP server successfully!');

    // Set up a listener for log messages
    // Use the transport's onmessage to listen for notifications
    const originalOnMessage = transport.onmessage;
    transport.onmessage = (message: any) => {
      // Check if this is a notification message with the right method
      if (message && message.method === 'notifications/message') {
        const notificationMessage = message as NotificationMessage;
        const { level, data } = notificationMessage.params;
        console.log(`[${level}] ${JSON.stringify(data)}`);
      }
      // Call the original onmessage handler
      if (originalOnMessage) {
        originalOnMessage(message);
      }
    };

    // Test different log levels
    const logLevels: LoggingLevel[] = [
      'debug',
      'info',
      'notice',
      'warning',
      'error',
      'critical',
      'alert',
      'emergency',
    ];

    for (const level of logLevels) {
      console.log(`\nSetting log level to: ${level}`);
      await client.setLoggingLevel(level);

      // Call the greet tool to generate some logs
      console.log(`Calling greet tool with log level ${level}...`);
      const result = await client.callTool({
        name: 'greet',
        arguments: { name: `LOG_LEVEL_${level.toUpperCase()}` },
      });
      console.log(`Greet tool result: ${JSON.stringify(result)}`);

      // Wait a bit to see all logs
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Close the connection
    // The Client class doesn't have a disconnect method, but we can close the transport
    await transport.close();
    console.log('Connection closed');
    console.log('Log level test completed successfully!');
  } catch (error) {
    console.error('Log level test failed with error:', error);
  }
}

// Run the test
testLogLevelClient();
