# @nest-mind/mcp-core

## 0.2.1

### Patch Changes

- 9106628: Publish core package to NPM for clean architecture
  - Make @nest-mind/mcp-core publicly available on NPM
  - Remove private flag to enable publishing
  - Core package provides shared types and utilities for MCP implementations
  - Server package depends on published core package automatically

  This enables clean separation of concerns while maintaining simple user experience - users only install the server package and get core automatically.

## 0.2.0

### Minor Changes

- 5ccf8f4: Initial release of @nest-mind/mcp packages

  This is the first release of the NestJS MCP (Model Context Protocol) packages:
  - **@nest-mind/mcp-core**: Core types, utilities, and validation schemas for MCP
  - **@nest-mind/mcp-server**: Full-featured NestJS MCP server implementation with multiple transport support

  Features included:
  - Complete TypeScript support with full type definitions
  - Multiple transport protocols (WebSocket, SSE, HTTP, stdio)
  - Decorator-based API for easy tool, resource, and prompt definition
  - Built-in validation and error handling
  - Comprehensive testing and documentation
