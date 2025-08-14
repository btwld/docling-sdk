# @nest-mind/mcp-server

## 0.2.5

### Patch Changes

- 2124c28: Fix peerDependencies to eliminate all NestJS 11.x warnings
  - Update @nestjs/event-emitter peerDependency to include ^3.0.0
  - Update @nestjs/schedule peerDependency to include ^5.0.0 and ^6.0.0
  - Completely eliminate peer dependency warnings during installation
  - Ensure compatibility with all supported NestJS versions (8.x - 11.x)

  This completes the NestJS 11.x compatibility by fixing the peerDependencies that were still referencing older version ranges.

## 0.2.4

### Patch Changes

- 6126486: Update NestJS dependencies to resolve peer dependency warnings
  - Update @nestjs/event-emitter from ^2.1.1 to ^3.0.1 (supports NestJS 11.x)
  - Update @nestjs/schedule from ^4.0.1 to ^6.0.0 (supports NestJS 11.x)
  - Eliminate peer dependency warnings when using with NestJS 11.x
  - All tests passing with updated dependencies

  This resolves the peer dependency warnings that were appearing during installation with NestJS 11.x projects.

## 0.2.3

### Patch Changes

- 346dd4c: Fix GitHub release creation and workflow improvements
  - Improve GitHub release creation workflow to handle existing releases gracefully
  - Add proper tag pushing after package publishing
  - Add checks to only create releases for packages that were actually updated
  - Better error handling and logging in release workflow
  - Ensure tags created by changesets are properly pushed to remote

  This fixes the issue where GitHub releases weren't being created due to missing tags and improves the overall release process reliability.

## 0.2.2

### Patch Changes

- b9e2da9: Fix critical package issues for better compatibility
  - **BREAKING FIX**: Fixed package entry points from `dist/index.js` to `dist/src/index.js` to match actual build output
  - **DEPENDENCY**: Implemented build-time bundling of @nest-mind/mcp-core into server package to eliminate external dependency issues while keeping core as internal workspace package for future client implementations
  - **COMPATIBILITY**: Updated NestJS peer dependencies to include v11.x support
  - **DOCS**: Fixed README examples to use correct `instructions` field instead of `description`
  - **DOCS**: Added comprehensive StreamableHTTP stateless mode documentation with required headers
  - **VALIDATION**: Added pre-publish validation scripts to prevent future packaging issues
  - **EXAMPLES**: Added complete working example with weather service demonstrating best practices
  - **BUILD**: Added automated core package bundling script that copies core dist files and updates import paths during build

  This patch release resolves import issues, dependency resolution problems, and NestJS 11.x compatibility warnings that were preventing successful usage of the library. The core package remains available as an internal workspace dependency for future packages like client implementations.

## 0.2.1

### Patch Changes

- Fix export naming conflicts and make core package private

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

### Patch Changes

- Updated dependencies [5ccf8f4]
  - @nest-mind/mcp-core@0.2.0
