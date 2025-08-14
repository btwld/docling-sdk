import { Injectable } from '@nestjs/common';
import { Tool } from '../../../lib/decorators';
import { z } from 'zod';
import { Context } from '../../../lib/interfaces/mcp-tool.interface';
import {
  createTextResponse,
  createStructuredResponse,
} from '../../../lib/utils/response.util';
import { ResourceService } from '../services/resource.service';

// Tiny image for demo purposes
const TINY_IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';

/**
 * Tool provider with various tools
 */
@Injectable()
export class ToolProvider {
  constructor(private readonly resourceService: ResourceService) {}

  /**
   * Echo tool - echoes back the input
   */
  @Tool({
    name: 'echo',
    description: 'Echoes back the input',
    parameters: z.object({
      message: z.string().describe('Message to echo'),
    }),
  })
  async echo(params: { message: string }) {
    return createTextResponse(`Echo: ${params.message}`);
  }

  /**
   * Add tool - adds two numbers
   */
  @Tool({
    name: 'add',
    description: 'Adds two numbers',
    parameters: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
    outputSchema: z.object({
      sum: z.number(),
      inputs: z.object({
        a: z.number(),
        b: z.number(),
      }),
    }),
  })
  async add(params: { a: number; b: number }) {
    const sum = params.a + params.b;

    return createStructuredResponse({
      sum,
      inputs: {
        a: params.a,
        b: params.b,
      },
    });
  }

  /**
   * Long running operation tool - demonstrates progress updates
   */
  @Tool({
    name: 'longRunningOperation',
    description: 'Demonstrates a long running operation with progress updates',
    parameters: z.object({
      duration: z
        .number()
        .default(10)
        .describe('Duration of the operation in seconds'),
      steps: z.number().default(5).describe('Number of steps in the operation'),
    }),
  })
  async longRunningOperation(
    params: { duration: number; steps: number },
    context: Context,
  ) {
    const { duration, steps } = params;
    const stepDuration = duration / steps;
    // Get progress token from context metadata if available
    const progressToken = (context as any)._meta?.progressToken;

    for (let i = 1; i <= steps; i++) {
      await new Promise((resolve) => setTimeout(resolve, stepDuration * 1000));

      if (progressToken) {
        await context.reportProgress({
          progress: i,
          total: steps,
        });
      }
    }

    return createTextResponse(
      `Long running operation completed. Duration: ${duration} seconds, Steps: ${steps}.`,
    );
  }

  /**
   * Get tiny image tool - returns a tiny image
   */
  @Tool({
    name: 'getTinyImage',
    description: 'Returns a tiny image',
    parameters: z.object({}),
  })
  async getTinyImage() {
    return {
      content: [
        {
          type: 'text',
          text: 'This is a tiny image:',
        },
        {
          type: 'image',
          data: TINY_IMAGE,
          mimeType: 'image/png',
        },
        {
          type: 'text',
          text: 'The image above is a tiny image.',
        },
      ],
    };
  }

  /**
   * Get resource reference tool - returns a resource reference
   */
  @Tool({
    name: 'getResourceReference',
    description: 'Returns a resource reference that can be used by MCP clients',
    parameters: z.object({
      resourceId: z
        .number()
        .min(1)
        .max(100)
        .describe('ID of the resource to reference (1-100)'),
    }),
  })
  async getResourceReference(params: { resourceId: number }) {
    const resourceId = params.resourceId;
    const resource = this.resourceService.getResourceByUri(
      `mcp://example/resource/${resourceId}`,
    );

    if (!resource) {
      throw new Error(`Resource with ID ${resourceId} does not exist`);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Returning resource reference for Resource ${resourceId}:`,
        },
        {
          type: 'resource',
          resource,
        },
        {
          type: 'text',
          text: `You can access this resource using the URI: ${resource.uri}`,
        },
      ],
    };
  }

  /**
   * Authenticated echo tool - requires authentication
   */
  @Tool({
    name: 'authenticatedEcho',
    description:
      'Echo the input with user information (requires authentication)',
    parameters: z.object({
      message: z.string().describe('Message to echo'),
    }),
  })
  async authenticatedEcho(
    params: { message: string },
    _context: Context,
    request: any,
  ) {
    // For debugging
    console.log('Request headers:', request?.headers);
    console.log('Request user:', request?.user);

    // Check if user is authenticated
    if (!request || !request.user) {
      // For demo purposes, allow test mode
      const testMode =
        request?.headers?.['x-test-mode'] || request?.headers?.['X-Test-Mode'];
      if (testMode === 'true') {
        console.log('Test mode enabled in tool, using default user');
        return createTextResponse(
          `Echo from alice (alice@example.com) [TEST MODE]: ${params.message}`,
        );
      }

      return createTextResponse('Error: Not authenticated', true);
    }

    // Return echo with user information
    const user = request.user;
    return createTextResponse(
      `Echo from ${user.username} (${user.email}): ${params.message}`,
    );
  }

  /**
   * Admin tool - requires admin role
   */
  @Tool({
    name: 'adminTool',
    description: 'Admin tool (requires admin role)',
    parameters: z.object({}),
  })
  async adminTool(_params: {}, _context: Context, request: any) {
    // For debugging
    console.log('Admin tool - Request headers:', request?.headers);
    console.log('Admin tool - Request user:', request?.user);

    // Check if user is authenticated
    if (!request || !request.user) {
      // For demo purposes, allow test mode
      const testMode =
        request?.headers?.['x-test-mode'] || request?.headers?.['X-Test-Mode'];
      if (testMode === 'true') {
        console.log('Test mode enabled in admin tool, using admin user');
        return createTextResponse(
          `Admin Information (TEST MODE):
Server Status: Online
Active Users: 42
System Load: 0.75
Last Backup: ${new Date().toISOString()}`,
        );
      }

      return createTextResponse('Error: Not authenticated', true);
    }

    // Check if user has admin role
    if (!request.user.roles.includes('admin')) {
      return createTextResponse(
        'Error: Insufficient permissions. Admin role required.',
        true,
      );
    }

    // Return admin information
    return createTextResponse(
      `Admin Information:
Server Status: Online
Active Users: 42
System Load: 0.75
Last Backup: ${new Date().toISOString()}`,
    );
  }
}
