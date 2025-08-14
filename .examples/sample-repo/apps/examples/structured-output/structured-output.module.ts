import { Module } from '@nestjs/common';
import { McpModule, McpTransportType } from '../../lib';
import { WeatherToolProvider } from './weather-tool.provider';

/**
 * Module for structured output example
 */
@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.STREAMABLE_HTTP,
      name: 'Structured Output Example Server',
      version: '1.0.0',
      streamableHttp: {
        endpoint: 'mcp',
        statelessMode: true,
      },
    }),
  ],
  providers: [WeatherToolProvider],
})
export class StructuredOutputModule {}
