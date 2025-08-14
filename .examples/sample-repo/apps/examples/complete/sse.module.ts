import { Module } from '@nestjs/common';
import { McpModule } from '../../lib/mcp.module';
import { McpTransportType } from '../../lib/types/common';
import { AuthGuard } from './guards/auth.guard';
import { AuthService } from './services/auth.service';
import { ResourceService } from './services/resource.service';
import { PromptService } from './services/prompt.service';
import { ToolProvider } from './providers/tool.provider';
import { AuthController } from './controllers/auth.controller';
import { McpController } from './controllers/mcp.controller';

/**
 * SSE example module that demonstrates all MCP features with SSE transport
 */
@Module({
  imports: [
    McpModule.forRoot({
      name: 'Complete Example MCP Server (SSE)',
      version: '1.0.0',
      transport: McpTransportType.SSE,
      sse: {
        endpoint: 'sse',
        messagesEndpoint: 'message',
      },
      guards: [AuthGuard], // Apply the auth guard to all MCP endpoints
    }),
  ],
  providers: [
    AuthGuard,
    AuthService,
    ResourceService,
    PromptService,
    ToolProvider,
  ],
  controllers: [AuthController, McpController],
})
export class SseModule {}
