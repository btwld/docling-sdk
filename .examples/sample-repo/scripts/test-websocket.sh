#!/bin/bash

# Start the WebSocket server
echo "Starting WebSocket server..."
npm run start:websocket &
SERVER_PID=$!

# Wait for the server to start
echo "Waiting for server to start..."
sleep 3

# Run the WebSocket client test
echo "Running WebSocket client test..."
npm run test:websocket

# Kill the server
echo "Stopping WebSocket server..."
kill $SERVER_PID

echo "WebSocket test completed!"
