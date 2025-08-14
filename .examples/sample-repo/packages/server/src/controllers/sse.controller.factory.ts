import {
  CanActivate,
  Controller,
  Get,
  Inject,
  Logger,
  OnModuleInit,
  Post,
  Req,
  Res,
  Type,
  UseGuards,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { McpRegistryService } from '../services/mcp-registry.service';
import { McpExecutorService } from '../services/mcp-executor.service';
import { McpErrorHandlerService } from '../services/mcp-error-handler.service';
import { AuthInfo } from '../types/auth.types';

/**
 * Map of active SSE connections
 */
interface SseConnection {
  id: string;
  res: Response;
  transport: SSEServerTransport;
  server: McpServer;
  lastEventId: string | null;
  createdAt: Date;
  subscriptions?: Set<string>;
}

/**
 * Creates a controller for SSE (Server-Sent Events) transport
 *
 * @param sseEndpoint The endpoint for SSE connections
 * @param messagesEndpoint The endpoint for SSE messages
 * @param globalPrefix Global API prefix
 * @param guards Guards to apply to the controller
 * @returns Controller class
 */
export function createSseController(
  sseEndpoint: string,
  messagesEndpoint: string,
  globalPrefix: string,
  guards: Type<CanActivate>[] = [],
): Type<any> {
  const path = globalPrefix ? `${globalPrefix}/${sseEndpoint}` : sseEndpoint;

  const decorators =
    guards.length > 0 ? [UseGuards(...(guards as [Type<CanActivate>]))] : [];

  @Controller(path)
  class SseController implements OnModuleInit {
    private readonly logger = new Logger(SseController.name);
    private readonly connections = new Map<string, SseConnection>();

    constructor(
      @Inject('MCP_OPTIONS') private readonly options: McpOptions,
      private readonly moduleRef: ModuleRef,
      private readonly toolRegistry: McpRegistryService,
      private readonly errorHandler: McpErrorHandlerService,
    ) {}

    /**
     * Initialize the controller
     */
    onModuleInit() {
      this.logger.log(`SSE controller initialized at /${path}`);
      this.logger.log(`SSE messages endpoint: /${path}/${messagesEndpoint}`);
    }

    /**
     * Handle SSE connection requests
     */
    @Get()
    async handleSse(@Req() req: Request, @Res() res: Response) {
      if (req.headers['x-test-mode'] === 'true') {
        this.logger.debug(
          'Test mode detected, bypassing authentication for SSE',
        );
      }

      // Set up SSE connection headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      // Generate a connection ID
      const connectionId = randomUUID();
      const lastEventId = (req.headers['last-event-id'] as string) || null;

      // Create the transport
      // Use the full path to preserve any custom paths in the URL
      const messagesPath = `/${path}/${messagesEndpoint}`;
      const transport = new SSEServerTransport(messagesPath, res);

      // Create the MCP server
      // Add logging capability to support notifications/message
      const capabilities = this.toolRegistry.generateCapabilities(
        this.options.capabilities || {},
      );

      // Ensure logging capability is included
      const enhancedCapabilities = {
        ...capabilities,
        logging: { enabled: true },
      };

      const mcpServer = new McpServer(
        { name: this.options.name, version: this.options.version },
        {
          capabilities: enhancedCapabilities,
          instructions: this.options.instructions,
        },
      );

      // Store connection info
      this.connections.set(connectionId, {
        id: connectionId,
        res,
        transport,
        server: mcpServer,
        lastEventId,
        createdAt: new Date(),
      });

      this.logger.log(`SSE connection established: ${connectionId}`);

      // Connect the MCP server to the transport
      await mcpServer.connect(transport);

      // The SSEServerTransport will automatically append the sessionId as a query parameter
      // to the messagesPath while preserving any existing query parameters and hash fragments
      // This is handled internally by the SSEServerTransport.start() method

      // Construct the endpoint URL with session ID as query parameter
      // The SSEClientTransport expects a URL that will be resolved against the base connection URL
      // It must be a relative URL that resolves to the same origin
      // The URL should point to the messages endpoint with the session ID as a query parameter
      const endpointUrl = `/${path}/${messagesEndpoint}?sessionId=${connectionId}`;

      // Send endpoint event as required by the SSEClientTransport
      // This is critical - the SSEClientTransport uses this URL for sending POST requests
      this.sendEvent(res, 'endpoint', endpointUrl);

      // Set up close handler
      req.on('close', () => {
        this.connections.delete(connectionId);
        this.logger.log(`SSE connection closed: ${connectionId}`);
      });
    }

    /**
     * Handle SSE message requests
     *
     * This endpoint handles JSON-RPC messages sent by the client via POST requests
     * The client sends these messages to the endpoint URL provided in the 'endpoint' event
     */
    @Post(messagesEndpoint)
    @UseGuards(...guards)
    async handleMessage(@Req() req: Request, @Res() res: Response) {
      try {
        // Validate content type
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
          return res.status(415).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message:
                'Unsupported Media Type: Content-Type must be application/json',
            },
            id: null,
          });
        }

        // Get the session ID from the query parameters
        const sessionId = req.query.sessionId as string;

        if (!sessionId) {
          return res.status(400).json({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32000,
              message: 'Missing sessionId parameter',
            },
          });
        }

        // Get the connection
        const connection = this.connections.get(sessionId);
        if (!connection) {
          return res.status(404).json({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32000,
              message: 'Session not found',
            },
          });
        }

        // Get the transport and server
        const transport = connection.transport;
        const mcpServer = connection.server;

        // Set up the executor
        const contextId = ContextIdFactory.getByRequest(req);
        const executor = await this.moduleRef.resolve(
          McpExecutorService,
          contextId,
          { strict: false },
        );

        const customRequest = {} as Record<string, unknown>;
        customRequest.originalRequest = req;

        // Extract auth info from the request if available
        // Get auth info from the request (set by NestJS auth guards)
        if (req.headers.authorization) {
          // Extract token from Authorization header
          const authHeader = req.headers.authorization;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
              // Extract user info from the token
              // In a real application, this would be done by your auth middleware
              // and the user object would be attached to the request
              const token = authHeader.substring(7);

              // For JWT tokens, we can extract the payload
              // This is just for demonstration - in production, use a proper JWT library
              const base64Payload = token.split('.')[1];
              if (base64Payload) {
                const payload = JSON.parse(
                  Buffer.from(base64Payload, 'base64').toString(),
                );

                // Create auth info from the payload
                customRequest.auth = {
                  userId: payload.sub,
                  username: payload.username,
                  email: payload.email,
                  roles: payload.roles,
                  token: token,
                };
              }
            } catch (error) {
              this.logger.error(
                'Error extracting auth info from token:',
                error,
              );
            }
          }
        }

        executor.registerRequestHandlers(mcpServer, customRequest);

        // Handle the message
        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        // Handle errors
        const errorResponse = this.errorHandler.handleError(null, error);
        res.status(500).json(errorResponse);
      }
    }

    /**
     * Handle ping events
     */
    @OnEvent('sse.ping')
    handlePing(payload: any) {
      this.broadcastEvent('ping', {
        jsonrpc: '2.0',
        method: 'notifications/ping',
        params: payload,
      });
    }

    /**
     * Send an event to a specific SSE connection
     *
     * This follows the exact format expected by the ModelContextProtocol SDK's SSEClientTransport
     *
     * @param res Response object
     * @param event Event name
     * @param data Event data
     */
    private sendEvent(res: Response, event: string, data: any) {
      try {
        // Format the data as a string
        const formattedData =
          typeof data === 'string' ? data : JSON.stringify(data);

        // Write the event in the exact format expected by the SSEClientTransport
        // The format is: event: {event}\ndata: {data}\n\n
        // Note: We don't include an ID as it's not used by the SSEClientTransport
        res.write(`event: ${event}\n`);
        res.write(`data: ${formattedData}\n\n`);

        // Flush the response to ensure the event is sent immediately
        const response = res as any;
        if (response.flush && typeof response.flush === 'function') {
          response.flush();
        }
      } catch (error) {
        this.logger.error(`Failed to send SSE event: ${error}`);
      }
    }

    /**
     * Broadcast an event to all SSE connections
     *
     * @param event Event name
     * @param data Event data
     */
    private broadcastEvent(event: string, data: any) {
      for (const connection of this.connections.values()) {
        this.sendEvent(connection.res, event, data);
      }
    }
  }

  if (guards.length > 0) {
    UseGuards(...(guards as [Type<CanActivate>]))(SseController);
  } else {
    for (const decorator of decorators) {
      decorator(SseController);
    }
  }

  return SseController;
}
