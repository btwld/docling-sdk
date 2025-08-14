import { NestFactory } from '@nestjs/core';
import { WeatherModule } from './weather.module';

async function bootstrap() {
  const app = await NestFactory.create(WeatherModule);

  // Enable CORS for testing
  app.enableCors();

  // Start the server on port 3000
  await app.listen(3000);
  console.log('Weather MCP server running on http://localhost:3000');
}

bootstrap();
