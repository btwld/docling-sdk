import { Injectable } from '@nestjs/common';
import { Tool } from '../../../lib/decorators';
import { z } from 'zod';
import { Context } from '../../../lib/interfaces/mcp-tool.interface';
import { createTextResponse } from '../../../lib/utils/response.util';

/**
 * Example tool provider with public tools that don't require authentication
 */
@Injectable()
export class PublicToolProvider {
  /**
   * Echo the input
   * Public tool - no authentication required
   */
  @Tool({
    name: 'publicEcho',
    description: 'Echo the input (public tool)',
    parameters: z.object({
      message: z.string().describe('Message to echo'),
    }),
  })
  async publicEcho(params: { message: string }) {
    return createTextResponse(`Echo: ${params.message}`);
  }

  /**
   * Get server time
   * Public tool - no authentication required
   */
  @Tool({
    name: 'getServerTime',
    description: 'Get the current server time (public tool)',
    parameters: z.object({}),
  })
  async getServerTime() {
    const now = new Date();
    return createTextResponse(`Server time: ${now.toISOString()}`);
  }

  /**
   * Calculate sum
   * Public tool - no authentication required
   */
  @Tool({
    name: 'calculateSum',
    description: 'Calculate the sum of two numbers (public tool)',
    parameters: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
  })
  async calculateSum(params: { a: number; b: number }) {
    const sum = params.a + params.b;
    return createTextResponse(`Sum: ${params.a} + ${params.b} = ${sum}`);
  }
}
