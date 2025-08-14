import { NestFactory } from '@nestjs/core';
import { CompleteModule } from './complete.module';

/**
 * Bootstrap the StreamableHTTP server
 */
async function bootstrap() {
  const app = await NestFactory.create(CompleteModule);
  
  // Enable CORS
  app.enableCors();
  
  // Start the server
  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  console.log(`Complete Example MCP Server (StreamableHTTP) running on http://localhost:${port}`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
  console.log('Auth endpoints:');
  console.log(`  - POST http://localhost:${port}/auth/login - Get a token`);
  console.log(`  - GET http://localhost:${port}/auth/users - List available users`);
  console.log('');
  console.log('Available users:');
  console.log('  - alice (regular user)');
  console.log('  - bob (admin user)');
}

bootstrap();
