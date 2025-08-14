import { Type } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { McpWebSocketGateway } from './websocket.gateway';
import { McpOptions } from '../interfaces/mcp-options.interface';

/**
 * Create a WebSocket gateway with the specified options
 * @param options The MCP options
 * @returns A WebSocket gateway class
 */
export function createWebSocketGateway(options: McpOptions): Type<any> {
  const namespace = options.websocket?.endpoint || 'ws';

  const cors = options.websocket?.cors || {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  };

  const socketIoOptions = options.websocket?.socketIoOptions || {};

  const gatewayOptions = {
    namespace,
    cors,
    ...socketIoOptions,
  };

  const GatewayClass = WebSocketGateway(
    0,
    gatewayOptions,
  )(McpWebSocketGateway) as Type<any>;

  return GatewayClass;
}
