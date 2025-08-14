import { NestFactory } from '@nestjs/core';
import { McpAuthModule } from './mcp-auth.module';

/**
 * Bootstrap the application
 */
async function bootstrap() {
  const app = await NestFactory.create(McpAuthModule);
  
  // Enable CORS
  app.enableCors();
  
  // Start the server
  await app.listen(3000);
  
  console.log('MCP Server with NestJS Auth running on http://localhost:3000');
  console.log('MCP endpoint: http://localhost:3000/mcp');
  console.log('Auth endpoints:');
  console.log('  - POST /auth/login - Get a token');
  console.log('  - GET /auth/profile - Get current user profile (requires auth)');
  console.log('  - GET /auth/users - List available users');
  console.log('');
  console.log('Available users:');
  console.log('  - alice (regular user)');
  console.log('  - bob (admin user)');
}

bootstrap();
