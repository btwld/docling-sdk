import { Injectable } from '@nestjs/common';
import { Tool } from '@nest-mind/mcp-server';
import { z } from 'zod';

/**
 * Example tool provider with decorator-based capability detection
 */
@Injectable()
export class ExampleToolProvider {
  /**
   * Example tool that adds two numbers
   * @param a First number
   * @param b Second number
   * @returns The sum of a and b
   */
  @Tool({
    name: 'add',
    description: 'Add two numbers',
    parameters: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
  })
  async add(params: { a: number; b: number }): Promise<{ result: number }> {
    return { result: params.a + params.b };
  }

  /**
   * Example tool that multiplies two numbers
   * @param a First number
   * @param b Second number
   * @returns The product of a and b
   */
  @Tool({
    name: 'multiply',
    description: 'Multiply two numbers',
    parameters: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
    }),
  })
  async multiply(params: {
    a: number;
    b: number;
  }): Promise<{ result: number }> {
    return { result: params.a * params.b };
  }
}
