# Contributing to Docling SDK

Thank you for your interest in contributing to the Docling SDK! This guide will help you get started.

## 🚀 Quick Start

1. **Fork and Clone**

   ```bash
   git clone https://github.com/btwld/docling-sdk.git
   cd docling-sdk
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Run Tests**
   ```bash
   npm test
   ```

## 📋 Development Workflow

### Branch Strategy

- `main` - Production releases
- `next` - Pre-release features
- `beta` - Beta testing
- `alpha` - Alpha testing
- `feature/*` - New features
- `fix/*` - Bug fixes
- `chore/*` - Maintenance tasks

### Commit Convention

We use [Conventional Commits](https://conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `ci`: CI/CD changes
- `perf`: Performance improvements

**Examples:**

```bash
feat(api): add streaming support for large files
fix(cli): resolve timeout issue with large documents
docs(readme): update installation instructions
```

### Release Process

Releases are **fully automated** using semantic-release:

1. **Patch Release** (`1.0.0` → `1.0.1`)

   ```bash
   git commit -m "fix: resolve memory leak in file processing"
   ```

2. **Minor Release** (`1.0.0` → `1.1.0`)

   ```bash
   git commit -m "feat: add new OCR engine support"
   ```

3. **Major Release** (`1.0.0` → `2.0.0`)

   ```bash
   git commit -m "feat!: redesign API interface

   BREAKING CHANGE: The API interface has been completely redesigned"
   ```

## 🧪 Testing

### Running Tests

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# All tests
npm run test:all

# With coverage
npm run test:coverage

# Watch mode
npm run test:ui
```

### Writing Tests

- Place unit tests in `tests/unit/`
- Place integration tests in `tests/integration/`
- Use descriptive test names
- Mock external dependencies
- Aim for >90% code coverage

## 🔧 Code Quality

### Linting and Formatting

```bash
# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Format code
npm run format:fix

# Type checking
npm run typecheck
```

### Pre-commit Checks

Before committing, ensure:

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Types are correct (`npm run typecheck`)
- [ ] Build succeeds (`npm run build`)

## 📦 Publishing

Publishing is **completely automated**:

1. **Merge to `main`** → Triggers production release
2. **Merge to `next`** → Triggers pre-release (`1.0.0-next.1`)
3. **Merge to `beta`** → Triggers beta release (`1.0.0-beta.1`)
4. **Merge to `alpha`** → Triggers alpha release (`1.0.0-alpha.1`)

### What Happens Automatically:

- ✅ Version bump in `package.json`
- ✅ Generate `CHANGELOG.md`
- ✅ Create GitHub release with notes
- ✅ Publish to npm
- ✅ Update git tags
- ✅ Commit changes back to repo

## 🐛 Bug Reports

When reporting bugs, please include:

- Node.js version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Error messages/stack traces

## 💡 Feature Requests

For new features:

- Check existing issues first
- Describe the use case
- Provide examples
- Consider backward compatibility

## 📞 Getting Help

- 💬 **Discussions**: GitHub Discussions
- 🐛 **Issues**: GitHub Issues
- 📧 **Email**: [Your contact email]

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.
