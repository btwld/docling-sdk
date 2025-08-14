import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import {
  TOOL_METADATA,
  RESOURCE_METADATA,
  PROMPT_METADATA,
  MCP_TOOL_METADATA_KEY,
  MCP_RESOURCE_METADATA_KEY,
  MCP_PROMPT_METADATA_KEY,
} from '../decorators/constants';
import {
  ToolMetadata,
  ResourceMetadata,
  PromptMetadata,
} from '../types/capability.types';
import { McpRegistryService } from './mcp-registry.service';

/**
 * Service that discovers and registers MCP capabilities during application bootstrap
 * This service scans for decorated methods and registers them with the registry service
 */
@Injectable()
export class McpDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(McpDiscoveryService.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly registry: McpRegistryService,
  ) {}

  /**
   * Called when the application is initialized
   * Discovers all tools, resources, and prompts
   */
  onModuleInit() {
    this.discoverCapabilities();
  }

  /**
   * Discovers all capabilities (tools, resources, prompts) in the application
   */
  private discoverCapabilities() {
    const providers = this.discovery.getProviders();
    const controllers = this.discovery.getControllers();
    const allInstances = [...providers, ...controllers]
      .filter((wrapper) => wrapper.instance)
      .map((wrapper) => ({
        instance: wrapper.instance as object,
        token: wrapper.token,
      }));

    let toolCount = 0;
    let resourceCount = 0;
    let promptCount = 0;

    allInstances.forEach(({ instance, token }) => {
      this.metadataScanner.getAllMethodNames(instance).forEach((methodName) => {
        const methodRef = instance[methodName] as object;
        const methodMetaKeys = Reflect.getOwnMetadataKeys(methodRef);

        // Check for tool metadata using both old and new keys
        if (
          methodMetaKeys.includes(MCP_TOOL_METADATA_KEY) ||
          methodMetaKeys.includes(TOOL_METADATA)
        ) {
          const rawMetadata = Reflect.getMetadata(
            methodMetaKeys.includes(TOOL_METADATA)
              ? TOOL_METADATA
              : MCP_TOOL_METADATA_KEY,
            methodRef,
          );

          // Ensure the metadata has a description
          const metadata = {
            ...rawMetadata,
            description: rawMetadata.description || `Tool: ${rawMetadata.name}`,
          };

          this.registry.registerTool(metadata, token, methodName);
          toolCount++;
        }

        // Check for resource metadata using both old and new keys
        if (
          methodMetaKeys.includes(MCP_RESOURCE_METADATA_KEY) ||
          methodMetaKeys.includes(RESOURCE_METADATA)
        ) {
          const metadata: ResourceMetadata = Reflect.getMetadata(
            methodMetaKeys.includes(RESOURCE_METADATA)
              ? RESOURCE_METADATA
              : MCP_RESOURCE_METADATA_KEY,
            methodRef,
          );
          this.registry.registerResource(metadata, token, methodName);
          resourceCount++;
        }

        // Check for prompt metadata using both old and new keys
        if (
          methodMetaKeys.includes(MCP_PROMPT_METADATA_KEY) ||
          methodMetaKeys.includes(PROMPT_METADATA)
        ) {
          const rawMetadata = Reflect.getMetadata(
            methodMetaKeys.includes(PROMPT_METADATA)
              ? PROMPT_METADATA
              : MCP_PROMPT_METADATA_KEY,
            methodRef,
          );

          // Ensure the metadata has a description
          const metadata = {
            ...rawMetadata,
            description:
              rawMetadata.description || `Prompt: ${rawMetadata.name}`,
          };

          this.registry.registerPrompt(metadata, token, methodName);
          promptCount++;
        }
      });
    });

    this.logger.log(
      `Discovered ${toolCount + resourceCount + promptCount} capabilities`,
    );
    this.logger.log(
      `Tools: ${toolCount}, Resources: ${resourceCount}, Prompts: ${promptCount}`,
    );
  }
}
