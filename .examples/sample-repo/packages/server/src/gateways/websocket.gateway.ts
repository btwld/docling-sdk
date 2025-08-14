import {
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsResponse,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { McpExecutorService } from '../services/mcp-executor.service';
import { McpErrorHandlerService } from '../services/mcp-error-handler.service';
import { McpValidationsService } from '../services/mcp-validations.service';
import { SessionManager } from '../utils/session-manager.util';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcErrorResponse,
} from '../types/json-rpc.types';

/**
 * WebSocket gateway for MCP
 * Handles WebSocket connections and messages
 */
export class McpWebSocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(McpWebSocketGateway.name);
  private readonly endpoint: string;
  private readonly sessionManager: SessionManager<Socket>;

  private getSessionId(client: Socket): string {
    return client.id;
  }

  private handleError(
    payload: JsonRpcRequest,
    error: unknown,
  ): JsonRpcErrorResponse {
    const errorResponse = this.errorHandler.handleError(
      payload?.id || null,
      error,
    );

    // Since we know this is an error response, we can safely cast it
    return errorResponse as JsonRpcErrorResponse;
  }

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    private readonly moduleRef: ModuleRef,
    private readonly errorHandler: McpErrorHandlerService,
    private readonly validations: McpValidationsService,
  ) {
    this.endpoint = options.websocket?.endpoint || 'ws';

    this.sessionManager = new SessionManager<Socket>({
      logger: new Logger('WebSocketSessionManager'),
      sessionTimeout: options.websocket?.sessionTimeout || 1800000,
      sessionIdGenerator: () => '',
      testSessionId: 'test-session-id',
      onSessionClosed: (sessionId) => {
        this.logger.debug(`Session ${sessionId} closed by session manager`);
      },
    });

    this.logger.log(
      `WebSocket gateway initialized at namespace /${this.endpoint}`,
    );
  }

  /**
   * Initialize the gateway
   */
  afterInit() {
    this.logger.log('WebSocket gateway initialized');
  }

  /**
   * Handle new connections
   */
  handleConnection(client: Socket) {
    const sessionId = this.getSessionId(client);
    this.logger.log(`Client connected: ${sessionId}`);

    client.emit('connection', {
      status: 'connected',
      sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle disconnections
   */
  handleDisconnect(client: Socket) {
    const sessionId = this.getSessionId(client);
    this.logger.log(`Client disconnected: ${sessionId}`);

    if (this.sessionManager.hasSession(sessionId)) {
      this.sessionManager.closeSession(sessionId);
    }
  }

  /**
   * Handle initialize message
   */
  @SubscribeMessage('initialize')
  async handleInitialize(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JsonRpcRequest,
  ): Promise<WsResponse<JsonRpcResponse>> {
    try {
      await Promise.resolve(this.validations.validateJsonRpcRequest(payload));

      const sessionId = this.getSessionId(client);

      if (this.sessionManager.hasSession(sessionId)) {
        this.sessionManager.closeSession(sessionId);
      }

      const mcpServer = new McpServer(
        { name: this.options.name, version: this.options.version },
        {
          capabilities: this.options.capabilities || {},
          instructions: this.options.instructions,
        },
      );

      // Use type assertion for Socket.io specific properties
      const socketWithHandshake = client as Socket & {
        handshake?: { headers: Record<string, string> };
      };

      this.sessionManager.createSession(client, mcpServer, {
        isTestSession:
          socketWithHandshake.handshake?.headers['x-test-mode'] === 'true',
      });

      return {
        event: 'initialize',
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            name: this.options.name,
            version: this.options.version,
          },
        },
      };
    } catch (error) {
      const errorResponse = this.handleError(payload, error);

      return {
        event: 'error',
        data: errorResponse,
      };
    }
  }

  /**
   * Handle method calls
   */
  @SubscribeMessage('call')
  async handleCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JsonRpcRequest,
  ): Promise<WsResponse<JsonRpcResponse>> {
    try {
      await Promise.resolve(this.validations.validateJsonRpcRequest(payload));

      const sessionId = this.getSessionId(client);
      const session = this.sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found. Please initialize first.');
      }

      const { method, params, id } = payload;

      const contextId = ContextIdFactory.create();
      const executorService = await this.moduleRef.resolve(
        McpExecutorService,
        contextId,
      );

      const customRequest = {} as Record<string, unknown>;
      customRequest.client = client;

      executorService.registerRequestHandlers(session.server, customRequest);

      // Ensure params is a proper Record<string, unknown> or undefined
      const safeParams = params
        ? (params as Record<string, unknown>)
        : undefined;
      const result = await executorService.executeMethod(method, safeParams);

      return {
        event: 'result',
        data: {
          jsonrpc: '2.0',
          id,
          result,
        },
      };
    } catch (error) {
      const errorResponse = this.handleError(payload, error);

      return {
        event: 'error',
        data: errorResponse,
      };
    }
  }

  /**
   * Handle notifications
   */
  @SubscribeMessage('notify')
  handleNotify(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JsonRpcRequest,
  ): void {
    try {
      this.validations.validateJsonRpcRequest(payload);

      const sessionId = this.getSessionId(client);
      const session = this.sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found. Please initialize first.');
      }

      const { method, params } = payload;

      client.emit('notification', {
        jsonrpc: '2.0',
        method,
        params,
      });
    } catch (error) {
      client.emit('error', {
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Dispose of the gateway resources
   * This method should be called when the gateway is being destroyed
   */
  dispose(): void {
    this.sessionManager.dispose();
  }
}
