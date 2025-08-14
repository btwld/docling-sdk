import {
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpOptions } from '../../lib/interfaces/mcp-options.interface';
import { McpRegistryService } from '../../lib/services/mcp-registry.service';
import { McpExecutorService } from '../../lib/services/mcp-executor.service';
import { McpErrorHandlerService } from '../../lib/services/mcp-error-handler.service';
import { SsePingService } from '../../lib/services/sse-ping.service';

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
 * Custom SSE controller for the example server
 */
@Controller('sse')
export class CustomSseController {
  private readonly logger = new Logger(CustomSseController.name);
  private readonly connections = new Map<string, SseConnection>();

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    private readonly moduleRef: ModuleRef,
    private readonly toolRegistry: McpRegistryService,
    private readonly eventEmitter: EventEmitter2,
    private readonly ssePingService: SsePingService,
    private readonly errorHandler: McpErrorHandlerService,
  ) {
    this.logger.log('Custom SSE controller initialized');
  }

  /**
   * Handle SSE connection requests
   */
  @Get()
  async handleSse(@Req() req: Request, @Res() res: Response) {
    // Set up SSE connection headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Generate a connection ID
    const connectionId = randomUUID();
    const lastEventId = (req.headers['last-event-id'] as string) || null;

    // Create the transport
    const transport = new SSEServerTransport(
      `/sse/messages?sessionId=${connectionId}`,
      res,
    );

    // Create the MCP server
    const mcpServer = new McpServer(
      { name: this.options.name, version: this.options.version },
      {
        capabilities: this.toolRegistry.generateCapabilities(
          this.options.capabilities || {},
        ),
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

    // Construct the endpoint URL with session ID as query parameter
    const endpointUrl = `/sse/messages?sessionId=${connectionId}`;

    // Send endpoint event as required by the SSEClientTransport
    this.sendEvent(res, 'endpoint', endpointUrl);

    // Set up close handler
    req.on('close', () => {
      this.connections.delete(connectionId);
      this.logger.log(`SSE connection closed: ${connectionId}`);
    });
  }

  /**
   * Handle SSE message requests
   */
  @Post('messages')
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

      executor.registerRequestHandlers(mcpServer, customRequest);

      // Get the request body
      const body = req.body;

      // Check if this is a tool execution request
      if (body && body.method && body.method.startsWith('tools/')) {
        // Extract the tool name from the method
        const toolName = body.method.replace('tools/', '');

        // Get the executor service
        const executor = await this.moduleRef.resolve(
          McpExecutorService,
          contextId,
          { strict: false },
        );

        // Execute the tool
        const result = await executor.executeTool(toolName, body.params, {
          sessionId: sessionId,
          originalRequest: req,
        });

        // Return the result
        return res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result,
        });
      }

      // For other requests, use the standard transport handler
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
   */
  private sendEvent(res: Response, event: string, data: any) {
    try {
      // Format the data as a string
      const formattedData =
        typeof data === 'string' ? data : JSON.stringify(data);

      // Write the event in the exact format expected by the SSEClientTransport
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
   */
  private broadcastEvent(event: string, data: any) {
    for (const connection of this.connections.values()) {
      this.sendEvent(connection.res, event, data);
    }
  }
}
