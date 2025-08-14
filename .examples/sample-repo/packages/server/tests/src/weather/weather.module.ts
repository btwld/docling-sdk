import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller';
import { McpModule, McpTransportType } from '../../../src';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'weather-mcp',
      version: '1.0.0',
      transport: [McpTransportType.STREAMABLE_HTTP, McpTransportType.SSE],
      capabilities: {
        notifications: {
          message: true,
          progress: true,
          logging: true,
        },
      },
      streamableHttp: {
        endpoint: 'mcp',
        enableResumability: true,
      },
      sse: {
        endpoint: 'sse',
        messagesEndpoint: 'messages',
      },
    }),
  ],
  controllers: [WeatherController],
})
export class WeatherModule {}
