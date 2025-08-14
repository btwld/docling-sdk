# Contributing to NestJS MCP

Thank you for your interest in contributing to the NestJS MCP ecosystem! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 18 or higher
- pnpm 8 or higher
- Git

### Getting Started

1. Fork the repository
2. Clone your fork:

   ```bash
   git clone git@github.com:YOUR_USERNAME/mcp.git
   cd mcp
   ```

3. Install dependencies:

   ```bash
   pnpm install
   ```

4. Build all packages:

   ```bash
   pnpm run build
   ```

5. Run tests to ensure everything is working:
   ```bash
   pnpm run test
   ```

## Development Workflow

### Making Changes

1. Create a new branch for your feature/fix:

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the appropriate package(s)

3. Add tests for your changes

4. Run the development commands:

   ```bash
   # Build packages
   pnpm run build

   # Run tests
   pnpm run test

   # Run linting
   pnpm run lint

   # Type checking
   pnpm run check-types
   ```

### Adding a Changeset

For any user-facing changes, you need to add a changeset:

```bash
pnpm changeset
```

This will prompt you to:

- Select which packages are affected
- Choose the type of change (patch, minor, major)
- Write a summary of the changes

### Commit Guidelines

We follow conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Example:

```bash
git commit -m "feat(server): add support for custom transport options"
```

## Package Structure

```
packages/
├── core/           # Shared types and utilities
├── server/         # MCP server implementation
├── client/         # MCP client (future)
├── gateway/        # MCP gateway (future)
├── testing/        # Testing utilities (future)
└── cli/            # CLI tools (future)
```

## Testing

- Unit tests: `pnpm run test`
- E2E tests: `pnpm run test:e2e`
- Test specific package: `pnpm --filter @nest-mind/mcp-server test`

## Documentation

- Update README files when adding new features
- Add JSDoc comments for public APIs
- Update examples when relevant

## Pull Request Process

1. Ensure all tests pass
2. Add a changeset if needed
3. Update documentation
4. Create a pull request with a clear description
5. Link any related issues

## Release Process

Releases are automated through GitHub Actions:

1. Merge changes to `main`
2. Changesets will create a release PR
3. Merge the release PR to publish packages

## Getting Help

- Open an issue for bugs or feature requests
- Join our discussions for questions
- Check existing issues and PRs before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing! 🚀
