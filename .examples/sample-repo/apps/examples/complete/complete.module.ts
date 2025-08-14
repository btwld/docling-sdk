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
 * Complete example module that demonstrates all MCP features
 */
@Module({
  imports: [
    McpModule.forRoot({
      name: 'Complete Example MCP Server',
      version: '1.0.0',
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        endpoint: 'mcp',
        statelessMode: true,
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
  controllers: [
    AuthController,
    McpController,
  ],
})
export class CompleteModule {}
