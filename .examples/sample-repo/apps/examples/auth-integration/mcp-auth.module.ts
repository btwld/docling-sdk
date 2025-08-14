import { Module } from '@nestjs/common';
import { McpModule } from '../../lib/mcp.module';
import { McpTransportType } from '../../lib/types/common';
import { AuthModule } from './auth.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { McpToolsProvider } from './providers/mcp-tools.provider';

/**
 * MCP module with NestJS authentication integration
 */
@Module({
  imports: [
    // Import auth module
    AuthModule,
    
    // Import MCP module with auth guards
    McpModule.forRoot({
      name: 'MCP Server with NestJS Auth',
      version: '1.0.0',
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        endpoint: 'mcp',
        statelessMode: true,
      },
      // Apply JWT auth guard to all MCP endpoints
      guards: [JwtAuthGuard, RolesGuard],
    }),
  ],
  providers: [McpToolsProvider],
})
export class McpAuthModule {}
