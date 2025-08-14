# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-05-16

### Added

- Initial release of the NestJS MCP Server
- Support for multiple transport types:
  - StreamableHTTP
  - WebSocket
  - Server-Sent Events (SSE)
  - Standard I/O (STDIO)
- Decorator-based approach for defining tools, resources, and prompts
- Automatic capability discovery
- Session management for stateful connections
- Event store for resumability
- Comprehensive error handling
- Validation of JSON-RPC requests and responses
- Support for streaming responses
- Examples for different transport types and use cases
- Comprehensive test suite
