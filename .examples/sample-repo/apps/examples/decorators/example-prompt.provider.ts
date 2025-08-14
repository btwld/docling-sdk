import { Injectable } from '@nestjs/common';
import { Prompt } from '../../lib/decorators';
import { z } from 'zod';

/**
 * Example prompt provider with decorator-based capability detection
 */
@Injectable()
export class ExamplePromptProvider {
  /**
   * Example prompt that generates a greeting
   * @param name Person's name
   * @returns A greeting message
   */
  @Prompt({
    name: 'greeting',
    description: 'Generate a greeting message',
    parameters: z.object({
      name: z.string().describe('Person\'s name'),
      formal: z.boolean().optional().describe('Whether to use formal language'),
    }),
    template: 'Hello, {{name}}!',
    examples: ['Hello, John!', 'Hello, Jane!'],
  })
  async greeting(params: { name: string; formal?: boolean }): Promise<{ content: string }> {
    const prefix = params.formal ? 'Dear' : 'Hello';
    return { content: `${prefix}, ${params.name}!` };
  }

  /**
   * Example prompt that generates a summary
   * @param text Text to summarize
   * @returns A summary of the text
   */
  @Prompt({
    name: 'summarize',
    description: 'Generate a summary of a text',
    parameters: z.object({
      text: z.string().describe('Text to summarize'),
      maxLength: z.number().optional().describe('Maximum length of the summary'),
    }),
    template: 'Summarize the following text: {{text}}',
    examples: ['Summarize the following text: Lorem ipsum dolor sit amet...'],
  })
  async summarize(params: { text: string; maxLength?: number }): Promise<{ content: string }> {
    // This is a simple example, in a real application you would use a more sophisticated summarization algorithm
    const words = params.text.split(' ');
    const maxLength = params.maxLength || 10;
    const summary = words.slice(0, maxLength).join(' ') + (words.length > maxLength ? '...' : '');
    return { content: summary };
  }
}
