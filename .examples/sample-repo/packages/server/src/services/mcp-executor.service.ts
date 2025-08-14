import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Injectable, Logger, Scope, Type } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  LoggingLevel,
  McpError,
  Progress,
  ReadResourceRequestSchema,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpRegistryService } from './mcp-registry.service';
import { McpLoggingService } from './mcp-logging.service';
import { Context, SerializableValue } from '../interfaces/mcp-tool.interface';
import { dtoToZodSchema } from '../utils/dto-to-schema.util';
import {
  createErrorResponse,
  createTextResponse,
  McpResponse,
} from '../utils/response.util';
import { NullableMcpRequest } from '../interfaces/mcp-server.interface';
import {
  DiscoveredTool,
  ToolMetadata,
} from '../interfaces/mcp-metadata.interface';
import { isZodTypeLike } from '../utils/zod-converter';

/**
 * Type for tool parameters
 */
type ToolParameters = Record<string, unknown>;

/**
 * Type for resource match result from registry
 */
type ResourceMatch = {
  resource: DiscoveredTool;
  params: Record<string, string>;
};

/**
 * Request-scoped service for executing MCP tools
 */
@Injectable({ scope: Scope.REQUEST })
export class McpExecutorService {
  private readonly logger = new Logger(McpExecutorService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly registry: McpRegistryService,
    private readonly loggingService: McpLoggingService,
  ) {}

  /**
   * Register tool-related request handlers with the MCP server
   * @param mcpServer - The MCP server instance
   * @param httpRequest - The current HTTP request object or a custom object
   */
  registerRequestHandlers(
    mcpServer: McpServer,
    httpRequest: Record<string, unknown>,
  ): void {
    this.registerTools(mcpServer, httpRequest);
    this.registerResources(mcpServer, httpRequest);
    this.registerLoggingHandlers(mcpServer);
  }

  private registerResources(
    mcpServer: McpServer,
    httpRequest: Record<string, unknown>,
  ) {
    const resources = this.registry.getResources();

    if (resources.length === 0) {
      return;
    }

    mcpServer.server.setRequestHandler(ListResourcesRequestSchema, () => {
      const data = {
        resources: resources.map((resource) => resource.metadata),
      };

      return data;
    });

    if (resources.length > 0) {
      mcpServer.server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request: z.infer<typeof ReadResourceRequestSchema>) => {
          const uri = request.params.uri;
          const resourceInfo = this.registry.findResourceByUri(uri);

          if (!resourceInfo) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown resource: ${uri}`,
            );
          }

          try {
            const contextId = ContextIdFactory.getByRequest(httpRequest);
            this.moduleRef.registerRequestByContextId(httpRequest, contextId);

            const resourceInstance = await this.moduleRef.resolve(
              resourceInfo.resource.providerClass as Type<unknown>,
              contextId,
              { strict: false },
            );

            if (!resourceInstance) {
              throw new McpError(
                ErrorCode.MethodNotFound,
                `Unknown resource: ${uri}`,
              );
            }

            const context = this.createContext(mcpServer, request);

            const requestParams = {
              ...resourceInfo.params,
              ...request.params,
            };

            const methodName = resourceInfo.resource.methodName;

            const result = await resourceInstance[methodName].call(
              resourceInstance,
              requestParams,
              context,
              httpRequest,
            );

            if (result && typeof result === 'object' && 'contents' in result) {
              return result as Record<string, unknown>;
            }

            if (result && typeof result === 'object' && 'content' in result) {
              const contentItems = result.content || [];

              const response: Record<string, unknown> = {};

              response.contents = contentItems.map((item: any) => ({
                uri: uri,
                mimeType: item.mimeType || 'text/plain',
                text: item.text || '',
              }));

              if (result.metadata) {
                response._meta = result.metadata;
              }

              if (result.isError) {
                response.isError = result.isError;
              }

              return response;
            }

            if (result === null || result === undefined) {
              return {
                contents: [
                  {
                    uri: uri,
                    mimeType: 'text/plain',
                    text: 'null',
                  },
                ],
                isError: false,
              };
            } else if (typeof result === 'object') {
              return {
                contents: [
                  {
                    uri: uri,
                    mimeType: 'text/plain',
                    text: JSON.stringify(result),
                  },
                ],
                isError: false,
              };
            } else {
              return {
                contents: [
                  {
                    uri: uri,
                    mimeType: 'text/plain',
                    text: String(result),
                  },
                ],
                isError: false,
              };
            }
          } catch (error) {
            return {
              contents: [
                {
                  uri: uri,
                  mimeType: 'text/plain',
                  text: error instanceof Error ? error.message : String(error),
                },
              ],
              isError: true,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      );
    }
  }

  /**
   * Register tool-related request handlers with the MCP server
   * @param mcpServer The MCP server instance
   * @param httpRequest The current HTTP request
   */
  private registerTools(
    mcpServer: McpServer,
    httpRequest: Record<string, unknown>,
  ): void {
    const tools = this.registry.getTools();
    if (tools.length === 0) {
      this.logger.debug('No tools registered, skipping tool handlers');
      return;
    }

    mcpServer.server.setRequestHandler(ListToolsRequestSchema, () => {
      const toolDefinitions = tools.map((tool) => {
        const metadata = tool.metadata as ToolMetadata;
        const inputSchema = this.generateToolInputSchema(tool);
        const toolDefinition: Record<string, unknown> = {
          name: metadata.name,
          description: metadata.description,
          inputSchema,
        };

        // Add outputSchema if present
        if (metadata.outputSchema) {
          if (isZodTypeLike(metadata.outputSchema)) {
            try {
              const zodSchema = metadata.outputSchema as z.ZodType<
                any,
                z.ZodTypeDef,
                any
              >;
              toolDefinition.outputSchema = zodToJsonSchema(zodSchema, {
                strictUnions: true,
              });
            } catch (error) {
              this.logger.warn(
                `Failed to convert Zod outputSchema to JSON schema for tool ${metadata.name}`,
                error instanceof Error ? error.stack : String(error),
              );
            }
          } else {
            // If it's already a JSON Schema object
            toolDefinition.outputSchema = metadata.outputSchema;
          }
        }

        // Add annotations if present
        if (metadata.annotations) {
          toolDefinition.annotations = metadata.annotations;
        }

        return toolDefinition;
      });

      return {
        tools: toolDefinitions,
      };
    });

    this.registerCallToolHandler(mcpServer, httpRequest);
  }

  /**
   * Generate JSON schema for tool input parameters
   * @param tool Tool information from registry
   * @returns JSON schema for the tool input
   */
  private generateToolInputSchema(
    tool: DiscoveredTool,
  ): Record<string, unknown> | undefined {
    if (tool.type !== 'tool') {
      return undefined;
    }

    const metadata = tool.metadata as ToolMetadata;

    if (metadata.inputSchema) {
      return metadata.inputSchema;
    }

    if (!metadata.parameters) {
      return undefined;
    }

    if (isZodTypeLike(metadata.parameters)) {
      try {
        const zodSchema = metadata.parameters as z.ZodType<
          any,
          z.ZodTypeDef,
          any
        >;
        return zodToJsonSchema(zodSchema);
      } catch (error) {
        this.logger.warn(
          `Failed to convert Zod schema to JSON schema for tool ${metadata.name}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    } else if (metadata.parameters) {
      try {
        // It must be a Type<unknown> if it's not a Zod type and not undefined
        const dtoClass = metadata.parameters as Type<unknown>;
        const zodSchema = dtoToZodSchema(dtoClass);
        return zodToJsonSchema(zodSchema);
      } catch (error) {
        this.logger.warn(
          `Failed to convert DTO to JSON schema for tool ${metadata.name}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      type: 'object',
      properties: {
        input: { type: 'string' },
        options: { type: 'object' },
      },
    };
  }

  /**
   * Register the call tool handler with the MCP server
   * @param mcpServer The MCP server instance
   * @param httpRequest The current HTTP request
   */
  private registerCallToolHandler(
    mcpServer: McpServer,
    httpRequest: Record<string, unknown>,
  ): void {
    mcpServer.server.setRequestHandler(
      CallToolRequestSchema,
      async (request: z.infer<typeof CallToolRequestSchema>) => {
        const toolName = request.params.name;
        this.logger.debug(`Handling tool call for: ${toolName}`);

        const toolInfo = this.registry.findTool(toolName);
        if (!toolInfo) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${toolName}`,
          );
        }

        try {
          const parsedParams = this.validateToolParameters(
            toolInfo,
            (request.params.arguments || {}) as ToolParameters,
          );

          const result = await this.executeTool(
            toolInfo,
            parsedParams,
            mcpServer,
            request,
            httpRequest,
          );

          // Create a response object
          const response: Record<string, unknown> = {};

          // Handle structured content if present
          if (result && typeof result === 'object') {
            if ('structuredContent' in result) {
              response.structuredContent = result.structuredContent;
            }

            // Always include content for backward compatibility
            if ('content' in result) {
              response.content = result.content || [];
            } else if ('structuredContent' in result) {
              // If no content but has structuredContent, create text representation
              response.content = [
                {
                  type: 'text',
                  text: JSON.stringify(result.structuredContent, null, 2),
                },
              ];
            } else {
              // Default empty content
              response.content = [];
            }

            // Include metadata if present
            if (result.metadata) {
              response._meta = result.metadata;
            }

            // Include error flag if present
            if (result.isError) {
              response.isError = result.isError;
            }

            return response;
          }

          // Default response if result is not properly formatted
          return {
            content: [],
            isError: false,
          };
        } catch (error) {
          if (error instanceof McpError) {
            throw error;
          }

          this.logger.error(
            `Error executing tool ${toolName}:`,
            error instanceof Error ? error.stack : String(error),
          );

          return {
            content: [
              {
                type: 'text',
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * Validate and parse tool parameters
   * @param toolInfo Tool information from registry
   * @param params Raw parameters from request
   * @returns Validated and parsed parameters
   */
  private validateToolParameters(
    toolInfo: DiscoveredTool,
    params: ToolParameters,
  ): ToolParameters {
    if (toolInfo.type !== 'tool') {
      return params;
    }

    const metadata = toolInfo.metadata as ToolMetadata;
    const schema = metadata.parameters;

    if (!schema) {
      return params;
    }

    if (isZodTypeLike(schema)) {
      // We know it's a Zod type if isZodTypeLike returns true
      const zodSchema = schema as z.ZodType<any, any, any>;
      const result = zodSchema.safeParse(params);
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid ${metadata.name} parameters: ${JSON.stringify(result.error.format())}`,
        );
      }
      return result.data as ToolParameters;
    }

    try {
      // It must be a Type<unknown> if it's not a Zod type
      const dtoClass = schema as Type<unknown>;
      const zodSchema = dtoToZodSchema(dtoClass);
      const result = zodSchema.safeParse(params);

      if (!result.success) {
        const errors = result.error.format();
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid ${metadata.name} parameters: ${JSON.stringify(errors)}`,
        );
      }

      const dtoInstance = new dtoClass();
      Object.assign(dtoInstance, result.data);

      return { data: dtoInstance };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }

      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid ${metadata.name} parameters: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Execute a tool with validated parameters
   * @param toolInfo Tool information from registry
   * @param params Validated parameters
   * @param mcpServer MCP server instance or null
   * @param mcpRequest Original MCP request or null
   * @param httpRequest HTTP request or null
   * @returns Tool execution result
   */
  /**
   * Execute a tool with validated parameters
   * @param toolInfo Tool information from registry
   * @param params Validated parameters
   * @param mcpServer MCP server instance or null
   * @param mcpRequest Original MCP request or null
   * @param httpRequest HTTP request or null
   * @returns Tool execution result
   */
  private async executeTool(
    toolInfo: DiscoveredTool,
    params: ToolParameters,
    mcpServer: McpServer | null,
    mcpRequest: NullableMcpRequest,
    httpRequest: Record<string, unknown> | null,
  ): Promise<McpResponse> {
    // Resolve the tool instance
    const toolInstance = await this.resolveToolInstance(toolInfo, httpRequest);

    const context = this.createContext(mcpServer, mcpRequest);

    if (toolInfo.type !== 'tool') {
      return createTextResponse(
        `Cannot execute non-tool type: ${toolInfo.type}`,
        true,
      );
    }

    const metadata = toolInfo.metadata as ToolMetadata;

    const schema = metadata.parameters;
    if (schema && !isZodTypeLike(schema)) {
      params.context = context;
    }

    try {
      // Execute the tool method
      const result = await this.invokeToolMethod(
        toolInstance,
        toolInfo,
        params,
        context,
        httpRequest,
        schema,
      );

      // Format the result as an MCP response
      return this.formatToolResult(result);
    } catch (error) {
      return createErrorResponse(
        error instanceof Error ? error : String(error),
      );
    }
  }

  /**
   * Execute a method by name with the given parameters
   * @param method The method name to execute
   * @param params The parameters to pass to the method
   * @returns The result of the method execution
   */
  /**
   * Execute a method by name with the given parameters
   * @param method The method name to execute
   * @param params The parameters to pass to the method
   * @returns The result of the method execution
   */
  async executeMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    this.logger.debug(`Executing method: ${method}`);

    // Handle special MCP protocol methods
    const specialMethodResult = this.handleSpecialMethods(method, params);
    if (specialMethodResult) {
      return specialMethodResult;
    }

    const toolInfo = this.registry.findTool(method);
    if (toolInfo) {
      try {
        // We use null instead of a NullMcpServer instance because
        // implementing the full McpServer interface is complex
        return await this.executeTool(toolInfo, params, null, null, null);
      } catch (error) {
        this.logger.error(`Error executing tool ${method}:`, error);
        return createErrorResponse(
          error instanceof Error ? error : String(error),
        );
      }
    }

    const resourceInfo = this.registry.findResourceByUri(method);
    if (resourceInfo) {
      try {
        return await this.executeResource(resourceInfo, params);
      } catch (error) {
        this.logger.error(`Error executing resource ${method}:`, error);
        return createErrorResponse(
          error instanceof Error ? error : String(error),
        );
      }
    }

    throw new Error(`Method not found: ${method}`);
  }

  /**
   * Create a context object for tool execution
   * @param mcpServer The MCP server instance
   * @param mcpRequest The MCP request
   * @returns A context object with progress reporting and logging
   */
  /**
   * Register logging-related request handlers with the MCP server
   * @param mcpServer The MCP server instance
   */
  private registerLoggingHandlers(mcpServer: McpServer): void {
    mcpServer.server.setRequestHandler(
      SetLevelRequestSchema,
      async (request: z.infer<typeof SetLevelRequestSchema>) => {
        const { level } = request.params;
        this.logger.log(`Setting log level to: ${level}`);

        // Update the log level in the logging service
        this.loggingService.setLogLevel(level);

        // Send a notification to confirm the level change
        try {
          await mcpServer.server.sendLoggingMessage({
            level: 'info',
            logger: 'mcp-server',
            data: `Logging level set to: ${level}`,
          });
        } catch (error) {
          this.logger.error(
            `Failed to send log level change notification: ${error}`,
          );
        }

        // Return an empty object as required by the protocol
        return {};
      },
    );
  }

  /**
   * Invoke a tool method with the appropriate parameters
   * @param toolInstance The resolved tool instance
   * @param toolInfo Tool information from registry
   * @param params Parameters to pass to the tool
   * @param context Execution context
   * @param httpRequest HTTP request or null
   * @param schema Parameter schema
   * @returns Result of the tool method invocation
   */
  private async invokeToolMethod(
    toolInstance: unknown,
    toolInfo: DiscoveredTool,
    params: ToolParameters,
    context: Context,
    httpRequest: Record<string, unknown> | null,
    schema: unknown,
  ): Promise<unknown> {
    if (isZodTypeLike(schema)) {
      // We know it's a Zod type if isZodTypeLike returns true
      return await toolInstance[toolInfo.methodName].call(
        toolInstance,
        params,
        context,
        httpRequest,
      );
    } else {
      return await toolInstance[toolInfo.methodName].call(
        toolInstance,
        params,
        undefined,
        httpRequest,
      );
    }
  }

  /**
   * Handle special MCP protocol methods
   * @param method Method name
   * @param params Method parameters
   * @returns Method result or null if not a special method
   */
  /**
   * Execute a resource with the given parameters
   * @param resourceInfo Resource information from registry
   * @param params Parameters to pass to the resource
   * @returns Result of the resource execution
   */
  private async executeResource(
    resourceInfo: ResourceMatch,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const resourceInstance = await this.moduleRef.resolve(
      resourceInfo.resource.providerClass as Type<unknown>,
    );

    if (!resourceInstance) {
      throw new Error(
        `Unknown resource: ${resourceInfo.resource.metadata.name}`,
      );
    }

    return await resourceInstance[resourceInfo.resource.methodName].call(
      resourceInstance,
      { ...resourceInfo.params, ...params },
    );
  }

  /**
   * Handle special MCP protocol methods
   * @param method Method name
   * @param _params Method parameters (unused)
   * @returns Method result or null if not a special method
   */
  private handleSpecialMethods(
    method: string,
    _params: Record<string, unknown>,
  ): Record<string, unknown> | null {
    if (method === 'initialize' || method === 'mcp/initialize') {
      return {
        server: {
          name: 'NestJS MCP Server',
          version: '1.0.0',
        },
        capabilities: this.registry.generateCapabilities({}),
      };
    }

    if (method === 'mcp/handshake') {
      return {
        status: 'ok',
      };
    }

    return null;
  }

  /**
   * Format a tool result as an MCP response
   * @param result Raw result from tool method invocation
   * @returns Formatted MCP response
   */
  private formatToolResult(result: unknown): McpResponse {
    // If the result is already a properly formatted MCP response with content or structuredContent
    if (result && typeof result === 'object') {
      const resultObj = result as Record<string, unknown>;

      // Check if it has structuredContent
      if ('structuredContent' in resultObj) {
        // If it has structuredContent but no content, add a text representation for backward compatibility
        if (!resultObj.content) {
          return {
            structuredContent: resultObj.structuredContent as Record<
              string,
              unknown
            >,
            content: [
              {
                type: 'text',
                text: JSON.stringify(resultObj.structuredContent, null, 2),
              },
            ],
            isError: resultObj.isError as boolean | undefined,
            metadata: resultObj.metadata as Record<string, unknown> | undefined,
          };
        }

        // If it has both structuredContent and content, return as is
        return result as McpResponse;
      }

      // If it has content but no structuredContent, return as is
      if ('content' in resultObj) {
        return result as McpResponse;
      }
    }

    // Handle primitive types and other objects
    if (result === null || result === undefined) {
      return createTextResponse('null');
    } else if (typeof result === 'object') {
      return createTextResponse(JSON.stringify(result, null, 2));
    } else if (
      typeof result === 'number' ||
      typeof result === 'boolean' ||
      typeof result === 'string'
    ) {
      return createTextResponse(String(result));
    } else {
      return createTextResponse(`Result of type: ${typeof result}`);
    }
  }

  /**
   * Resolve a tool instance from the module registry
   * @param toolInfo Tool information from registry
   * @param httpRequest HTTP request or null
   * @returns Resolved tool instance
   * @throws McpError if the tool instance cannot be resolved
   */
  private async resolveToolInstance(
    toolInfo: DiscoveredTool,
    httpRequest: Record<string, unknown> | null,
  ): Promise<unknown> {
    const contextId = ContextIdFactory.getByRequest(httpRequest);
    this.moduleRef.registerRequestByContextId(httpRequest, contextId);

    const toolInstance = await this.moduleRef.resolve(
      toolInfo.providerClass as Type<unknown>,
      contextId,
      { strict: false },
    );

    if (!toolInstance) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Failed to resolve tool instance: ${toolInfo.metadata.name}`,
      );
    }

    return toolInstance;
  }

  /**
   * Create a context object for tool execution
   * @param mcpServer The MCP server instance
   * @param mcpRequest The MCP request
   * @returns A context object with progress reporting and logging
   */
  private createContext(
    mcpServer: McpServer | null,
    mcpRequest: NullableMcpRequest,
  ): Context {
    const progressToken = mcpRequest?.params?._meta?.progressToken;

    const safeReportProgress = async (progress: Progress) => {
      if (!progressToken) return;

      try {
        if (
          mcpServer?.server &&
          'capabilities' in mcpServer.server &&
          typeof mcpServer.server.capabilities === 'object' &&
          mcpServer.server.capabilities &&
          'notifications' in mcpServer.server.capabilities
        ) {
          await mcpServer.server.notification({
            method: 'notifications/progress',
            params: {
              ...progress,
              progressToken,
            } as Progress,
          });
        }
      } catch (error) {
        this.logger.debug(
          'Failed to report progress',
          error instanceof Error ? error.message : String(error),
        );
      }
    };

    const createLogFunction = (level: string) => {
      return (message: string, context?: SerializableValue) => {
        // Convert level to LoggingLevel type
        const logLevel = level as LoggingLevel;

        // Check if we should log this message based on the current log level
        if (!this.loggingService.shouldLog(logLevel)) {
          return;
        }

        if (!mcpServer?.server?.sendLoggingMessage) {
          // If mcpServer is null or doesn't have sendLoggingMessage, log to console instead
          this.logger.log(`[${level}] ${message}`);
          return;
        }

        try {
          // Use void to explicitly ignore the Promise
          void mcpServer.server.sendLoggingMessage({
            level: logLevel,
            logger: 'mcp-server',
            data: { message, context },
          });
        } catch (error) {
          this.logger.debug(
            `Failed to log message: ${message}`,
            error instanceof Error ? error.message : String(error),
          );
        }
      };
    };

    return {
      reportProgress: safeReportProgress,
      log: {
        debug: createLogFunction('debug'),
        error: createLogFunction('error'),
        info: createLogFunction('info'),
        warn: createLogFunction('warning'),
      },
    };
  }
}
