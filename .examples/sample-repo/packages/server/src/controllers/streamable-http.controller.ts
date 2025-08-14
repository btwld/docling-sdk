import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  StreamableHTTPServerTransport,
  EventStore,
  StreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { EnhancedStreamableHTTPServerTransport } from '../utils/custom-transport.util';
import { ServerCapabilitiesUtil } from '../utils/server-capabilities.util';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { McpEventStoreService } from '../services/mcp-event-store.service';
import { McpExecutorService } from '../services/mcp-executor.service';
import { McpRegistryService } from '../services/mcp-registry.service';
import { McpErrorHandlerService } from '../services/mcp-error-handler.service';
import {
  extractJsonRpcId,
  isInitializeRequest,
  createJsonRpcErrorResponse,
  JsonRpcId,
} from '../types/json-rpc.types';
import { ErrorCode } from '../utils/error.util';
import { SessionManager } from '../utils/session-manager.util';
import {
  CustomRequest,
  StreamableHttpSessionData,
} from './interfaces/streamable-http.interface';
import { AuthInfo } from '../types/auth.types';

/**
 * Controller for handling HTTP-based MCP connections and tool executions
 * This controller handles both stateless and stateful modes of operation
 */
@Controller('mcp')
export class StreamableHttpController implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamableHttpController.name);

  private readonly sessionManager = new SessionManager<
    StreamableHTTPServerTransport,
    StreamableHttpSessionData
  >({
    logger: new Logger('StreamableHttpSessionManager'),
    onSessionClosed: (sessionId) => {
      this.logger.debug(`Session ${sessionId} closed by session manager`);
    },
  });

  private statelessTransport: StreamableHTTPServerTransport | null = null;
  private statelessMcpServer: McpServer | null = null;
  private isStatelessMode = false;
  private endpoint: string;

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    private readonly moduleRef: ModuleRef,
    private readonly toolRegistry: McpRegistryService,
    private readonly errorHandler: McpErrorHandlerService,
    @Optional()
    @Inject(McpEventStoreService)
    private readonly eventStore?: EventStore,
  ) {
    this.endpoint = options.streamableHttp?.endpoint || 'mcp';

    this.isStatelessMode = !!options.streamableHttp?.statelessMode;

    if (!this.isStatelessMode) {
      const sessionTimeout = options.session?.sessionTimeout || 1800000;
      const sessionIdGenerator =
        options.streamableHttp?.sessionIdGenerator || (() => randomUUID());

      this.sessionManager = new SessionManager<
        StreamableHTTPServerTransport,
        StreamableHttpSessionData
      >({
        logger: new Logger('StreamableHttpSessionManager'),
        sessionTimeout,
        sessionIdGenerator,
        testSessionId: 'test-session-id',
        onSessionClosed: (sessionId) => {
          this.logger.debug(`Session ${sessionId} closed by session manager`);
        },
      });

      this.logger.log(
        `Session manager configured with timeout: ${sessionTimeout}ms`,
      );
    } else {
      this.initializeStatelessMode()
        .then(() => {
          this.logger.debug('Stateless mode initialized');
        })
        .catch((error) => {
          this.logger.error('Error initializing stateless mode:', error);
        });
    }

    if (this.eventStore) {
      this.logger.log('Event store available for resumability support');
    }
  }

  /**
   * Initialize the stateless mode with a singleton transport and MCP server
   */
  private async initializeStatelessMode(): Promise<void> {
    this.logger.log('Initializing MCP Streamable HTTP in stateless mode');

    const transportOptions: StreamableHTTPServerTransportOptions = {
      sessionIdGenerator: undefined,
      enableJsonResponse:
        this.options.streamableHttp?.enableJsonResponse || false,
      eventStore: this.eventStore,
    };

    // Use our enhanced transport that handles initialization properly
    this.statelessTransport = new EnhancedStreamableHTTPServerTransport(
      transportOptions,
    );

    const capabilities = this.toolRegistry.generateCapabilities(
      this.options.capabilities || {},
    );

    // Ensure logging capability is included
    const enhancedCapabilities = {
      ...capabilities,
      logging: { enabled: true },
    };

    this.logger.debug(
      `Generated capabilities: ${JSON.stringify(enhancedCapabilities)}`,
    );

    this.statelessMcpServer = new McpServer(
      { name: this.options.name, version: this.options.version },
      {
        capabilities: enhancedCapabilities,
        instructions: this.options.instructions,
      },
    );

    // Use the server capabilities utility to safely set capabilities
    ServerCapabilitiesUtil.applyCapabilities(
      this.statelessMcpServer,
      capabilities,
    );

    await this.statelessMcpServer.connect(this.statelessTransport);

    this.logger.debug('Stateless mode initialized');
  }

  /**
   * Called when the module is initialized
   */
  onModuleInit() {
    this.logger.log(
      `Initialized MCP Streamable HTTP controller at ${this.endpoint} in ${
        this.isStatelessMode ? 'stateless' : 'stateful'
      } mode`,
    );
  }

  /**
   * Main HTTP endpoint for both initialization and subsequent requests
   * @param req Express request object
   * @param res Express response object
   * @param body Request body
   */
  @Post()
  async handlePostRequest(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ) {
    this.logger.debug('Received MCP request');

    try {
      if (this.isStatelessMode) {
        return this.handleStatelessRequest(req, res, body);
      } else {
        return this.handleStatefulRequest(req, res, body);
      }
    } catch (error) {
      this.logger.error('Error handling MCP request:', error);

      const errorResponse = this.errorHandler.handleError(
        this.extractRequestId(body),
        error,
      );

      if (!res.headersSent) {
        res.status(500).json(errorResponse);
      }
    }
  }

  /**
   * Handle requests in stateless mode
   * @param req Express request object
   * @param res Express response object
   * @param body Request body
   */
  private async handleStatelessRequest(
    req: Request,
    res: Response,
    body: unknown,
  ): Promise<void> {
    if (!this.statelessTransport || !this.statelessMcpServer) {
      await this.initializeStatelessMode();
    }

    const isInitialize = this.isInitializeRequest(body);

    if (isInitialize) {
      this.logger.debug('Handling initialize request in stateless mode');

      const capabilities = this.toolRegistry.generateCapabilities(
        this.options.capabilities || {},
      );

      // Use the server capabilities utility to safely set capabilities
      ServerCapabilitiesUtil.applyCapabilities(
        this.statelessMcpServer,
        capabilities,
      );
    }

    const contextId = ContextIdFactory.getByRequest(req);
    const executor = await this.moduleRef.resolve(
      McpExecutorService,
      contextId,
      { strict: false },
    );

    const customRequest: CustomRequest = {
      originalRequest: req,
    };

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
          this.logger.warn('Error extracting auth info from token:', error);
        }
      }
    }

    executor.registerRequestHandlers(this.statelessMcpServer, customRequest);

    await this.statelessTransport.handleRequest(req, res, body);
  }

  /**
   * Handle requests in stateful mode
   * @param req Express request object
   * @param res Express response object
   * @param body Request body
   */
  private async handleStatefulRequest(
    req: Request,
    res: Response,
    body: unknown,
  ): Promise<void> {
    const isTestMode = req.headers['x-test-mode'] === 'true';
    const testSessionId = 'test-session-id';

    if (isTestMode && !req.headers['mcp-session-id']) {
      this.logger.debug('Test mode detected, using test session ID');
      req.headers['mcp-session-id'] = testSessionId;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.sessionManager.hasSession(sessionId)) {
      const sessionData = this.sessionManager.getSession(sessionId);
      if (!sessionData) {
        res
          .status(404)
          .json(
            createJsonRpcErrorResponse(
              this.extractRequestId(body),
              ErrorCode.SESSION_EXPIRED,
              'Session not found',
              { errorType: 'SESSION_EXPIRED' },
            ),
          );
        return;
      }

      const transport = sessionData.transport;
      const mcpServer = sessionData.server;

      const contextId = ContextIdFactory.getByRequest(req);
      const executor = await this.moduleRef.resolve(
        McpExecutorService,
        contextId,
        { strict: false },
      );

      const customRequest: CustomRequest = {
        originalRequest: req,
      };

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
            this.logger.warn('Error extracting auth info from token:', error);
          }
        }
      }

      executor.registerRequestHandlers(mcpServer, customRequest);

      await transport.handleRequest(req, res, body);
      return;
    }

    if ((!sessionId && this.isInitializeRequest(body)) || isTestMode) {
      if (isTestMode && !this.isInitializeRequest(body)) {
        this.logger.debug('Creating test session for non-initialize request');
      }

      const transport = new EnhancedStreamableHTTPServerTransport({
        sessionIdGenerator: isTestMode
          ? () => 'test-session-id'
          : this.options.streamableHttp?.sessionIdGenerator ||
            (() => randomUUID()),
        enableJsonResponse:
          this.options.streamableHttp?.enableJsonResponse || false,
        eventStore: this.eventStore,
      });

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

      await mcpServer.connect(transport);

      await transport.handleRequest(req, res, body);

      if (transport.sessionId) {
        const sessionData: StreamableHttpSessionData = {
          isTestSession: isTestMode,
        };
        this.sessionManager.createSession(transport, mcpServer, sessionData);

        transport.onclose = () => {
          if (transport.sessionId) {
            this.sessionManager.closeSession(transport.sessionId);
          }
        };

        this.logger.log(
          `Initialized new session with ID: ${transport.sessionId}`,
        );
      }

      return;
    }

    res
      .status(400)
      .json(
        createJsonRpcErrorResponse(
          this.extractRequestId(body),
          ErrorCode.INVALID_REQUEST,
          'Bad Request: No valid session ID provided',
          { errorType: 'INVALID_REQUEST' },
        ),
      );
  }

  /**
   * GET endpoint for SSE streams
   * @param req Express request object
   * @param res Express response object
   */
  @Get()
  async handleGetRequest(@Req() req: Request, @Res() res: Response) {
    // We don't need auth info for GET requests, but keeping the pattern for consistency
    if (this.isStatelessMode) {
      if (!this.statelessTransport || !this.statelessMcpServer) {
        await this.initializeStatelessMode();
      }

      this.logger.debug('Establishing SSE stream in stateless mode');

      await this.statelessTransport.handleRequest(req, res);
      return;
    }

    const isTestMode = req.headers['x-test-mode'] === 'true';
    const testSessionId = 'test-session-id';

    if (isTestMode && !req.headers['mcp-session-id']) {
      this.logger.debug(
        'Test mode detected, using test session ID for GET request',
      );
      req.headers['mcp-session-id'] = testSessionId;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !this.sessionManager.hasSession(sessionId)) {
      if (isTestMode) {
        this.logger.debug('Creating test session for SSE');

        const transport = new EnhancedStreamableHTTPServerTransport({
          sessionIdGenerator: () => testSessionId,
          enableJsonResponse: false,
          eventStore: this.eventStore,
        });

        const capabilities = this.toolRegistry.generateCapabilities(
          this.options.capabilities || {},
        );

        const mcpServer = new McpServer(
          { name: this.options.name, version: this.options.version },
          {
            capabilities,
            instructions: this.options.instructions,
          },
        );

        await mcpServer.connect(transport);

        const sessionData: StreamableHttpSessionData = {
          isTestSession: true,
        };
        this.sessionManager.createSession(transport, mcpServer, sessionData);

        await transport.handleRequest(req, res);
        return;
      }

      res.status(400).send('Invalid or missing session ID');
      return;
    }

    this.logger.debug(`Establishing SSE stream for session ${sessionId}`);

    const sessionData = this.sessionManager.getSession(sessionId);
    if (sessionData) {
      await sessionData.transport.handleRequest(req, res);
    } else {
      res.status(404).send('Session not found');
    }
  }

  /**
   * DELETE endpoint for terminating sessions
   * @param req Express request object
   * @param res Express response object
   */
  @Delete()
  async handleDeleteRequest(@Req() req: Request, @Res() res: Response) {
    // We don't need auth info for DELETE requests, but keeping the pattern for consistency
    if (this.isStatelessMode) {
      res.status(200).end();
      return;
    }

    const isTestMode = req.headers['x-test-mode'] === 'true';
    const testSessionId = 'test-session-id';

    if (isTestMode && !req.headers['mcp-session-id']) {
      this.logger.debug(
        'Test mode detected, using test session ID for DELETE request',
      );
      req.headers['mcp-session-id'] = testSessionId;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId || !this.sessionManager.hasSession(sessionId)) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    this.logger.debug(`Terminating session ${sessionId}`);

    const sessionData = this.sessionManager.getSession(sessionId);
    if (sessionData) {
      await sessionData.transport.handleRequest(req, res);

      this.sessionManager.closeSession(sessionId);

      this.logger.log(`Session ${sessionId} terminated`);
    } else {
      res.status(404).send('Session not found');
    }
  }

  /**
   * Helper function to detect initialize requests
   * @param body Request body
   * @returns True if this is an initialize request
   */
  private isInitializeRequest(body: unknown): boolean {
    return isInitializeRequest(body);
  }

  /**
   * Extract request ID from the request body
   * @param body Request body
   * @returns Request ID or null
   */
  private extractRequestId(body: unknown): JsonRpcId {
    return extractJsonRpcId(body);
  }

  /**
   * Clean up resources when the module is destroyed
   */
  onModuleDestroy(): void {
    this.sessionManager.stopCleanupInterval();
  }
}
