import { NestFactory } from '@nestjs/core';
import { StructuredOutputModule } from './structured-output.module';

/**
 * Bootstrap the structured output example server
 */
async function bootstrap() {
  const app = await NestFactory.create(StructuredOutputModule);
  await app.listen(3000);
  console.log('Structured output example server running on http://localhost:3000/mcp');
}

bootstrap();
