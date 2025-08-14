import { NestFactory } from '@nestjs/core';
import { SseModule } from './sse.module';

/**
 * Bootstrap the SSE server
 */
async function bootstrap() {
  const app = await NestFactory.create(SseModule);
  
  // Enable CORS
  app.enableCors();
  
  // Start the server
  const port = process.env.PORT || 3001;
  await app.listen(port);
  
  console.log(`Complete Example MCP Server (SSE) running on http://localhost:${port}`);
  console.log(`SSE endpoint: http://localhost:${port}/sse`);
  console.log(`Message endpoint: http://localhost:${port}/message`);
  console.log('Auth endpoints:');
  console.log(`  - POST http://localhost:${port}/auth/login - Get a token`);
  console.log(`  - GET http://localhost:${port}/auth/users - List available users`);
  console.log('');
  console.log('Available users:');
  console.log('  - alice (regular user)');
  console.log('  - bob (admin user)');
}

bootstrap();
