# @nest-mind/mcp-core

Core types and utilities for the NestJS Model Context Protocol (MCP) ecosystem.

## Description

This package provides the foundational types, interfaces, and utilities used across all NestJS MCP packages. It includes TypeScript definitions for the Model Context Protocol specification and common utilities for building MCP-compatible applications.

## Installation

```bash
npm install @nest-mind/mcp-core
# or
pnpm add @nest-mind/mcp-core
# or
yarn add @nest-mind/mcp-core
```

## Features

- **TypeScript-first**: Full type safety with comprehensive TypeScript definitions
- **MCP Protocol Types**: Complete type definitions for the Model Context Protocol
- **Validation Schemas**: Zod schemas for runtime validation
- **Utility Functions**: Common utilities for MCP implementations
- **Framework Agnostic**: Can be used with any TypeScript/JavaScript framework

## Usage

### Basic Types

```typescript
import {
  McpRequest,
  McpResponse,
  Tool,
  Resource,
  Prompt,
} from '@nest-mind/mcp-core';

// Use MCP types in your application
const tool: Tool = {
  name: 'example-tool',
  description: 'An example tool',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
  },
};
```

### Validation Schemas

```typescript
import { McpRequestSchema, ToolSchema } from '@nest-mind/mcp-core';

// Validate MCP requests
const request = McpRequestSchema.parse(incomingData);

// Validate tool definitions
const tool = ToolSchema.parse(toolData);
```

### Utility Functions

```typescript
import { createMcpResponse, validateMcpMessage } from '@nest-mind/mcp-core';

// Create standardized MCP responses
const response = createMcpResponse({
  id: 'request-id',
  result: { success: true },
});

// Validate MCP messages
const isValid = validateMcpMessage(message);
```

## API Reference

### Types

- `McpRequest` - Base MCP request interface
- `McpResponse` - Base MCP response interface
- `Tool` - Tool definition interface
- `Resource` - Resource definition interface
- `Prompt` - Prompt definition interface
- `Transport` - Transport configuration interface

### Schemas

- `McpRequestSchema` - Zod schema for MCP requests
- `McpResponseSchema` - Zod schema for MCP responses
- `ToolSchema` - Zod schema for tool definitions
- `ResourceSchema` - Zod schema for resource definitions
- `PromptSchema` - Zod schema for prompt definitions

### Utilities

- `createMcpResponse()` - Create standardized MCP responses
- `validateMcpMessage()` - Validate MCP messages
- `parseMcpRequest()` - Parse and validate MCP requests
- `formatMcpError()` - Format MCP error responses

## Related Packages

- [@nest-mind/mcp-server](../server) - MCP server implementation for NestJS
- [@nest-mind/mcp-client](../client) - MCP client implementation _(coming soon)_
- [@nest-mind/mcp-gateway](../gateway) - MCP gateway/proxy implementation _(coming soon)_

## Contributing

See the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.

## Support

- 📖 [Documentation](https://github.com/nest-mind/mcp)
- 🐛 [Issue Tracker](https://github.com/nest-mind/mcp/issues)
- 💬 [Discussions](https://github.com/nest-mind/mcp/discussions)

## Model Context Protocol

Learn more about the Model Context Protocol:

- [MCP Specification](https://github.com/modelcontextprotocol/modelcontextprotocol)
- [MCP Documentation](https://modelcontextprotocol.io/)
