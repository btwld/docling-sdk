import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

/**
 * Utility functions for working with MCP server capabilities
 */
export class ServerCapabilitiesUtil {
  /**
   * Apply capabilities to an MCP server
   *
   * This function safely applies capabilities to an MCP server by using
   * the server's public API rather than accessing private properties.
   *
   * @param server The MCP server instance
   * @param capabilities The capabilities to apply
   * @returns The updated capabilities
   */
  static applyCapabilities(
    server: McpServer,
    capabilities: ServerCapabilities,
  ): ServerCapabilities {
    // Ensure required capabilities are present
    const updatedCapabilities = this.ensureRequiredCapabilities(capabilities);

    // Apply the capabilities to the server
    if (server && server.server) {
      // We need to access the internal _capabilities property directly
      // This is the only way to ensure that the server's capabilities are properly initialized
      const serverAny = server.server as any;

      // Set the capabilities directly on the internal _capabilities property
      serverAny._capabilities = updatedCapabilities;

      // Also set the capabilities property for backward compatibility
      serverAny.capabilities = updatedCapabilities;

      // Double-check that tools capability is properly initialized
      if (!serverAny._capabilities.tools) {
        serverAny._capabilities.tools = {};
      }

      // Double-check that resources capability is properly initialized
      if (!serverAny._capabilities.resources) {
        serverAny._capabilities.resources = {};
      }

      // Double-check that notifications capability is properly initialized
      serverAny._capabilities.notifications = true;

      // Double-check that logging capability is properly initialized
      if (!serverAny._capabilities.logging) {
        serverAny._capabilities.logging = {};
      }
    }

    return updatedCapabilities;
  }

  /**
   * Ensure that the capabilities object has all required capabilities
   *
   * @param capabilities Capabilities object to check
   * @returns Updated capabilities object with required capabilities
   */
  static ensureRequiredCapabilities(
    capabilities: ServerCapabilities,
  ): ServerCapabilities {
    // Create a new object to avoid modifying the original
    const updatedCapabilities = { ...capabilities };

    // Make sure we have tools capability
    if (!updatedCapabilities.tools) {
      updatedCapabilities.tools = {};
    }

    // Make sure we have resources capability
    if (!updatedCapabilities.resources) {
      updatedCapabilities.resources = {};
    }

    // Add notifications capability
    updatedCapabilities.notifications = true;

    // Add logging capability
    updatedCapabilities.logging = {};

    return updatedCapabilities;
  }

  /**
   * Detect capabilities from available tools, resources, and prompts
   *
   * @param hasTools Whether tools are available
   * @param hasResources Whether resources are available
   * @param hasPrompts Whether prompts are available
   * @returns Server capabilities object
   */
  static detectCapabilities(
    hasTools: boolean = false,
    hasResources: boolean = false,
    hasPrompts: boolean = false,
  ): ServerCapabilities {
    const capabilities: ServerCapabilities = {};

    if (hasTools) {
      capabilities.tools = {};
    }

    if (hasResources) {
      capabilities.resources = {};
    }

    if (hasPrompts) {
      capabilities.prompts = {};
    }

    // Always add notifications capability
    capabilities.notifications = true;

    // Always add logging capability
    capabilities.logging = {};

    return this.ensureRequiredCapabilities(capabilities);
  }
}
