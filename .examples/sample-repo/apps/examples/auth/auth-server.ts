import { NestFactory } from '@nestjs/core';
import { AuthServerModule } from './auth-server.module';

/**
 * Bootstrap the auth example server
 */
async function bootstrap() {
  const app = await NestFactory.create(AuthServerModule);
  
  // Enable CORS
  app.enableCors();
  
  // Start the server
  await app.listen(3000);
  console.log('Auth Example MCP Server running on http://localhost:3000');
  console.log('MCP endpoint: http://localhost:3000/mcp');
  console.log('Auth endpoints:');
  console.log('  - POST /auth/login - Get a token');
  console.log('  - GET /auth/users - List available users');
  console.log('');
  console.log('Available users:');
  console.log('  - alice (regular user)');
  console.log('  - bob (admin user)');
}

bootstrap();
