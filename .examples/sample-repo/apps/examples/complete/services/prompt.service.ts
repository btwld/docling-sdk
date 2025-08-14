import { Injectable } from '@nestjs/common';
import { ResourceService } from './resource.service';

// Tiny image for demo purposes
const TINY_IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';

/**
 * Service for prompt-related operations
 */
@Injectable()
export class PromptService {
  constructor(private readonly resourceService: ResourceService) {}

  /**
   * Get all available prompts
   * @returns List of prompts
   */
  getPrompts() {
    return [
      {
        name: 'simple_prompt',
        description: 'A prompt without arguments',
      },
      {
        name: 'complex_prompt',
        description: 'A prompt with arguments',
        arguments: [
          {
            name: 'temperature',
            description: 'Temperature setting',
            required: true,
          },
          {
            name: 'style',
            description: 'Output style',
            required: false,
          },
        ],
      },
      {
        name: 'resource_prompt',
        description: 'A prompt that includes an embedded resource reference',
        arguments: [
          {
            name: 'resourceId',
            description: 'Resource ID to include (1-100)',
            required: true,
          },
        ],
      },
    ];
  }

  /**
   * Get a prompt by name
   * @param name Prompt name
   * @param args Prompt arguments
   * @returns Prompt messages
   */
  getPrompt(name: string, args: Record<string, any> = {}) {
    switch (name) {
      case 'simple_prompt':
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: 'This is a simple prompt without arguments.',
              },
            },
          ],
        };

      case 'complex_prompt':
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `This is a complex prompt with arguments: temperature=${args?.temperature}, style=${args?.style}`,
              },
            },
            {
              role: 'assistant',
              content: {
                type: 'text',
                text: 'I understand. You\'ve provided a complex prompt with temperature and style arguments. How would you like me to proceed?',
              },
            },
            {
              role: 'user',
              content: {
                type: 'image',
                data: TINY_IMAGE,
                mimeType: 'image/png',
              },
            },
          ],
        };

      case 'resource_prompt':
        const resourceId = parseInt(args?.resourceId as string, 10);
        if (isNaN(resourceId) || resourceId < 1 || resourceId > 100) {
          throw new Error(`Invalid resourceId: ${args?.resourceId}. Must be a number between 1 and 100.`);
        }

        const resource = this.resourceService.getResourceByUri(`mcp://example/resource/${resourceId}`);
        if (!resource) {
          throw new Error(`Resource with ID ${resourceId} not found.`);
        }

        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `This prompt includes Resource ${resourceId}. Please analyze the following resource:`,
              },
            },
            {
              role: 'user',
              content: {
                type: 'resource',
                resource,
              },
            },
          ],
        };

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  }

  /**
   * Get completion suggestions for prompt arguments
   * @param argumentName Argument name
   * @param value Current value
   * @returns Completion suggestions
   */
  getCompletionSuggestions(argumentName: string, value: string) {
    const completions: Record<string, string[]> = {
      style: ['casual', 'formal', 'technical', 'friendly'],
      temperature: ['0', '0.5', '0.7', '1.0'],
      resourceId: Array.from({ length: 100 }, (_, i) => (i + 1).toString()),
    };

    const suggestions = completions[argumentName] || [];
    return suggestions.filter(suggestion => suggestion.startsWith(value));
  }
}
