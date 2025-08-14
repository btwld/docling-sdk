import { Injectable } from '@nestjs/common';
import { Tool } from '../../../lib/decorators';
import { z } from 'zod';
import { Context } from '../../../lib/interfaces/mcp-tool.interface';
import { createTextResponse } from '../../../lib/utils/response.util';

/**
 * Example tool provider with protected tools that require authentication
 */
@Injectable()
export class ProtectedToolProvider {
  /**
   * Get user profile information
   * Requires authentication
   */
  @Tool({
    name: 'getUserProfile',
    description: 'Get the current user profile information',
    parameters: z.object({}),
  })
  async getUserProfile(_params: {}, _context: Context, request: any) {
    // Check if user is authenticated
    if (!request || !request.user) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Not authenticated',
          },
        ],
        isError: true,
      };
    }

    // Return user profile
    const user = request.user;
    return {
      content: [
        {
          type: 'text',
          text: `User Profile:
ID: ${user.id}
Username: ${user.username}
Email: ${user.email}
Roles: ${user.roles.join(', ')}`,
        },
      ],
    };
  }

  /**
   * Get admin information
   * Requires admin role
   */
  @Tool({
    name: 'getAdminInfo',
    description: 'Get admin information (requires admin role)',
    parameters: z.object({}),
  })
  async getAdminInfo(_params: {}, _context: Context, request: any) {
    // Check if user is authenticated
    if (!request || !request.user) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Not authenticated',
          },
        ],
        isError: true,
      };
    }

    // Check if user has admin role
    if (!request.user.roles.includes('admin')) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Insufficient permissions. Admin role required.',
          },
        ],
        isError: true,
      };
    }

    // Return admin information
    return {
      content: [
        {
          type: 'text',
          text: `Admin Information:
Server Status: Online
Active Users: 42
System Load: 0.75
Last Backup: ${new Date().toISOString()}`,
        },
      ],
    };
  }

  /**
   * Echo the input with user information
   * Requires authentication
   */
  @Tool({
    name: 'authenticatedEcho',
    description: 'Echo the input with user information',
    parameters: z.object({
      message: z.string().describe('Message to echo'),
    }),
  })
  async authenticatedEcho(params: { message: string }, _context: Context, request: any) {
    // Check if user is authenticated
    if (!request || !request.user) {
      return createTextResponse('Error: Not authenticated', true);
    }

    // Return echo with user information
    const user = request.user;
    return createTextResponse(
      `Echo from ${user.username} (${user.email}): ${params.message}`
    );
  }
}
