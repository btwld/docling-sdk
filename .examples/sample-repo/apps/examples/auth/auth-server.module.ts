import { Module } from '@nestjs/common';
import { McpModule } from '../../lib/mcp.module';
import { McpTransportType } from '../../lib/types/common';
import { AuthModule } from './auth.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * Server module that uses the auth guard
 */
@Module({
  imports: [
    AuthModule,
    McpModule.forRoot({
      name: 'Auth Example MCP Server',
      version: '1.0.0',
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        endpoint: 'mcp',
        statelessMode: true,
      },
      guards: [JwtAuthGuard], // Apply the JWT auth guard to all MCP endpoints
    }),
  ],
})
export class AuthServerModule {}
