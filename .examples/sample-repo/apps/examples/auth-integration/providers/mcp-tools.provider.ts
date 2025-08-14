import { Injectable } from '@nestjs/common';
import { Tool } from '../../../lib/decorators';
import { z } from 'zod';
import { Context } from '../../../lib/interfaces/mcp-tool.interface';
import { Roles } from '../guards/roles.guard';
import { Public } from '../decorators/public.decorator';

/**
 * MCP tools provider with authentication integration
 */
@Injectable()
export class McpToolsProvider {
  /**
   * Public echo tool - no authentication required
   */
  @Public()
  @Tool({
    name: 'publicEcho',
    description: 'Echo back the input (public tool)',
    parameters: z.object({
      message: z.string().describe('Message to echo'),
    }),
  })
  async publicEcho(params: { message: string }) {
    return {
      content: [
        {
          type: 'text',
          text: `Echo: ${params.message}`,
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
    context: Context,
    request: any,
  ) {
    // For debugging
    console.log('Request in authenticatedEcho:', request);

    // Extract auth token from request headers
    const authHeader = request?.originalRequest?.headers?.authorization;
    console.log('Auth header:', authHeader);

    // Extract user info from JWT token
    let username = 'Unknown User';
    let email = 'unknown@example.com';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        // Decode JWT token (this is a simple decode, not verification)
        const base64Payload = token.split('.')[1];
        const payload = JSON.parse(
          Buffer.from(base64Payload, 'base64').toString(),
        );
        console.log('Decoded token payload:', payload);

        username = payload.username || 'Unknown User';
        email = payload.email || 'unknown@example.com';
      } catch (error) {
        console.error('Error decoding token:', error);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Echo from ${username} (${email}): ${params.message}`,
        },
      ],
    };
  }

  /**
   * Admin tool - requires admin role
   */
  @Roles('admin')
  @Tool({
    name: 'adminTool',
    description: 'Admin tool (requires admin role)',
    parameters: z.object({}),
  })
  async adminTool(_params: {}, _context: Context, request: any) {
    // For debugging
    console.log('Request in adminTool:', request);

    // Extract auth token from request headers
    const authHeader = request?.originalRequest?.headers?.authorization;
    console.log('Auth header:', authHeader);

    // Extract user info from JWT token
    let username = 'Unknown User';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        // Decode JWT token (this is a simple decode, not verification)
        const base64Payload = token.split('.')[1];
        const payload = JSON.parse(
          Buffer.from(base64Payload, 'base64').toString(),
        );
        console.log('Decoded token payload:', payload);

        username = payload.username || 'Unknown User';
      } catch (error) {
        console.error('Error decoding token:', error);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Admin Information for ${username}:
Server Status: Online
Active Users: 42
System Load: 0.75
Last Backup: ${new Date().toISOString()}`,
        },
      ],
    };
  }
}
