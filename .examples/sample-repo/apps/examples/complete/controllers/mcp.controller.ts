import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ResourceService } from '../services/resource.service';
import { PromptService } from '../services/prompt.service';
import { AuthGuard } from '../guards/auth.guard';

/**
 * Controller for MCP-specific endpoints
 */
@Controller('mcp-api')
export class McpController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly promptService: PromptService,
  ) {}

  /**
   * Get resources
   * @param cursor Pagination cursor
   * @returns Resources and next cursor
   */
  @Get('resources')
  @UseGuards(AuthGuard)
  getResources(@Query('cursor') cursor?: string) {
    let startIndex = 0;
    if (cursor) {
      try {
        startIndex = parseInt(Buffer.from(cursor, 'base64').toString(), 10);
      } catch (error) {
        // Invalid cursor, use default
      }
    }
    return this.resourceService.getResources(startIndex);
  }

  /**
   * Get resource by ID
   * @param id Resource ID
   * @returns Resource
   */
  @Get('resources/:id')
  @UseGuards(AuthGuard)
  getResource(@Param('id') id: string) {
    const resource = this.resourceService.getResourceByUri(`mcp://example/resource/${id}`);
    if (!resource) {
      throw new Error(`Resource with ID ${id} not found`);
    }
    return { resource };
  }

  /**
   * Subscribe to a resource
   * @param body Request body
   * @returns Success status
   */
  @Post('resources/subscribe')
  @UseGuards(AuthGuard)
  subscribeToResource(@Body() body: { uri: string }) {
    const success = this.resourceService.subscribeToResource(body.uri);
    return { success };
  }

  /**
   * Unsubscribe from a resource
   * @param body Request body
   * @returns Success status
   */
  @Post('resources/unsubscribe')
  @UseGuards(AuthGuard)
  unsubscribeFromResource(@Body() body: { uri: string }) {
    const success = this.resourceService.unsubscribeFromResource(body.uri);
    return { success };
  }

  /**
   * Get resource templates
   * @returns Resource templates
   */
  @Get('resource-templates')
  @UseGuards(AuthGuard)
  getResourceTemplates() {
    return {
      templates: this.resourceService.getResourceTemplates(),
    };
  }

  /**
   * Get prompts
   * @returns Prompts
   */
  @Get('prompts')
  @UseGuards(AuthGuard)
  getPrompts() {
    return {
      prompts: this.promptService.getPrompts(),
    };
  }

  /**
   * Get prompt by name
   * @param name Prompt name
   * @param args Prompt arguments
   * @returns Prompt messages
   */
  @Post('prompts/:name')
  @UseGuards(AuthGuard)
  getPrompt(@Param('name') name: string, @Body() args: Record<string, any>) {
    return this.promptService.getPrompt(name, args);
  }

  /**
   * Get completion suggestions
   * @param body Request body
   * @returns Completion suggestions
   */
  @Post('completions')
  @UseGuards(AuthGuard)
  getCompletions(@Body() body: { argumentName: string; value: string }) {
    const { argumentName, value } = body;
    const suggestions = this.promptService.getCompletionSuggestions(argumentName, value);
    return {
      suggestions,
      hasMore: false,
      total: suggestions.length,
    };
  }
}
