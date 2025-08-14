import { Module } from '@nestjs/common';
import { ExampleToolProvider } from './example-tool.provider';
import { ExampleResourceProvider } from './example-resource.provider';
import { ExamplePromptProvider } from './example-prompt.provider';

/**
 * Example module that provides tools, resources, and prompts
 */
@Module({
  providers: [
    ExampleToolProvider,
    ExampleResourceProvider,
    ExamplePromptProvider,
  ],
  exports: [
    ExampleToolProvider,
    ExampleResourceProvider,
    ExamplePromptProvider,
  ],
})
export class ExampleModule {}
