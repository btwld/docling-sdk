import { Injectable, InjectionToken, Logger } from '@nestjs/common';
import { match } from 'path-to-regexp';
import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { ToolMetadata, ResourceMetadata, PromptMetadata } from '../decorators';

/**
 * Interface representing a discovered tool, resource, or prompt
 */
export type DiscoveredTool<T extends object> = {
  type: 'tool' | 'resource' | 'prompt';
  metadata: T;
  providerClass: InjectionToken;
  methodName: string;
};

/**
 * Registry service that stores and manages MCP capabilities
 * Provides methods to register, find, and generate capabilities
 */
@Injectable()
export class McpRegistryService {
  private readonly logger = new Logger(McpRegistryService.name);
  private discoveredTools: DiscoveredTool<any>[] = [];

  /**
   * Register a tool with the registry
   * @param metadata Tool metadata
   * @param token Provider token
   * @param methodName Method name
   */
  registerTool(
    metadata: ToolMetadata,
    token: InjectionToken,
    methodName: string,
  ): void {
    this.discoveredTools.push({
      type: 'tool',
      metadata,
      providerClass: token,
      methodName,
    });
    this.logger.debug(`Registered tool: ${metadata.name}`);
  }

  /**
   * Register a resource with the registry
   * @param metadata Resource metadata
   * @param token Provider token
   * @param methodName Method name
   */
  registerResource(
    metadata: ResourceMetadata,
    token: InjectionToken,
    methodName: string,
  ): void {
    this.discoveredTools.push({
      type: 'resource',
      metadata,
      providerClass: token,
      methodName,
    });
    this.logger.debug(`Registered resource: ${metadata.name}`);
  }

  /**
   * Register a prompt with the registry
   * @param metadata Prompt metadata
   * @param token Provider token
   * @param methodName Method name
   */
  registerPrompt(
    metadata: PromptMetadata,
    token: InjectionToken,
    methodName: string,
  ): void {
    this.discoveredTools.push({
      type: 'prompt',
      metadata,
      providerClass: token,
      methodName,
    });
    this.logger.debug(`Registered prompt: ${metadata.name}`);
  }

  /**
   * Get all discovered tools
   */
  getTools(): DiscoveredTool<ToolMetadata>[] {
    return this.discoveredTools.filter((tool) => tool.type === 'tool');
  }

  /**
   * Find a tool by name
   */
  findTool(name: string): DiscoveredTool<ToolMetadata> | undefined {
    return this.getTools().find((tool) => tool.metadata.name === name);
  }

  /**
   * Get all discovered resources
   */
  getResources(): DiscoveredTool<ResourceMetadata>[] {
    return this.discoveredTools.filter((tool) => tool.type === 'resource');
  }

  /**
   * Find a resource by name
   */
  findResource(name: string): DiscoveredTool<ResourceMetadata> | undefined {
    return this.getResources().find((tool) => tool.metadata.name === name);
  }

  /**
   * Get all discovered prompts
   */
  getPrompts(): DiscoveredTool<PromptMetadata>[] {
    return this.discoveredTools.filter((tool) => tool.type === 'prompt');
  }

  /**
   * Find a prompt by name
   */
  findPrompt(name: string): DiscoveredTool<PromptMetadata> | undefined {
    return this.getPrompts().find((prompt) => prompt.metadata.name === name);
  }

  /**
   * Convert a template string to a path-to-regexp compatible string
   * @param template Template string
   * @returns Converted template string
   */
  private convertTemplate(template: string): string {
    return template?.replace(/{(\w+)}/g, ':$1');
  }

  /**
   * Convert a URI to a path-to-regexp compatible string
   * @param uri URI string
   * @returns Converted URI string
   */
  private convertUri(uri: string): string {
    if (uri.includes('://')) {
      return uri.split('://')[1];
    }

    return uri;
  }

  /**
   * Find a resource by uri
   * @param uri URI string
   * @returns An object containing the found resource and extracted parameters, or undefined if no resource is found
   */
  findResourceByUri(uri: string):
    | {
        resource: DiscoveredTool<ResourceMetadata>;
        params: Record<string, string>;
      }
    | undefined {
    const resources = this.getResources().map((tool) => ({
      name: tool.metadata.name,
      uri: tool.metadata.uri,
    }));

    const strippedInputUri = this.convertUri(uri);

    for (const t of resources) {
      if (!t.uri) continue;

      const rawTemplate = t.uri;
      const templatePath = this.convertTemplate(this.convertUri(rawTemplate));
      const matcher = match(templatePath, { decode: decodeURIComponent });
      const result = matcher(strippedInputUri);

      if (result) {
        const foundResource = this.findResource(t.name);
        if (!foundResource) continue;

        return {
          resource: foundResource,
          params: result.params as Record<string, string>,
        };
      }
    }

    return undefined;
  }

  /**
   * Generate server capabilities based on discovered tools, resources, and prompts
   * @param existingCapabilities Optional existing capabilities to merge with
   * @returns Server capabilities
   */
  generateCapabilities(
    existingCapabilities?: ServerCapabilities,
  ): ServerCapabilities {
    const capabilities: ServerCapabilities = existingCapabilities || {};

    const tools = this.getTools();
    if (tools.length > 0) {
      capabilities.tools = capabilities.tools || {};

      tools.forEach((tool) => {
        const metadata = tool.metadata;
        capabilities.tools[metadata.name] = {
          description: metadata.description,
          schema: metadata.parameters,
          ...(metadata.outputSchema
            ? { outputSchema: metadata.outputSchema }
            : {}),
          ...(metadata.annotations
            ? { annotations: metadata.annotations }
            : {}),
        };
      });
    }

    const resources = this.getResources();
    if (resources.length > 0) {
      capabilities.resources = capabilities.resources || {};

      resources.forEach((resource) => {
        const metadata = resource.metadata;
        capabilities.resources[metadata.name] = {
          description: metadata.description,
          schema: {},
        };
      });
    }

    const prompts = this.getPrompts();
    if (prompts.length > 0) {
      capabilities.prompts = capabilities.prompts || {};

      prompts.forEach((prompt) => {
        const metadata = prompt.metadata;
        capabilities.prompts[metadata.name] = {
          description: metadata.description,
          schema: {},
        };
      });
    }

    return capabilities;
  }
}
