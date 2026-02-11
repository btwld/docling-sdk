# Docling SDK

TypeScript SDK for [Docling](https://github.com/DS4SD/docling) -- bridge between the Python Docling ecosystem and JavaScript/TypeScript.

[![npm version](https://badge.fury.io/js/docling-sdk.svg)](https://www.npmjs.com/package/docling-sdk)
[![GitHub release](https://img.shields.io/github/release/btwld/docling-sdk.svg)](https://github.com/btwld/docling-sdk/releases)
[![npm downloads](https://img.shields.io/npm/dm/docling-sdk.svg)](https://www.npmjs.com/package/docling-sdk)
[![License](https://img.shields.io/npm/l/docling-sdk.svg)](https://github.com/btwld/docling-sdk/blob/main/LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/btwld/docling-sdk)

## What is Docling SDK?

Docling SDK provides document conversion, OCR, and chunking capabilities in TypeScript. It supports three client modes: an **API client** for Docling Serve, a **CLI client** wrapping the Python Docling tool, and a **Web OCR client** running entirely in the browser via WebGPU/WASM. The SDK works across Node.js, Bun, Deno, browsers, and Cloudflare Workers.

## Installation

```bash
npm install docling-sdk
```

Also available via GitHub Package Registry: `npm install @btwld/docling-sdk`

For Web OCR, install peer dependencies: `npm install @huggingface/transformers onnxruntime-web`

See the [Getting Started guide](./docs/getting-started.md) for prerequisites and setup.

## Quick Start

### API Client

```typescript
import { readFile } from "node:fs/promises";
import { Docling } from "docling-sdk";

const client = new Docling({ api: { baseUrl: "http://localhost:5001" } });
const buffer = await readFile("./document.pdf");

const result = await client.convert(buffer, "document.pdf", { to_formats: ["md"] });
console.log(result.document.md_content);
```

[Full API Client guide](./docs/api-client.md)

### CLI Client

```typescript
import { Docling } from "docling-sdk";

const client = new Docling({ cli: { outputDir: "./output" } });
const result = await client.convert("./document.pdf", "document.pdf", { to_formats: ["md"] });
console.log(result.document.md_content);
```

[Full CLI Client guide](./docs/cli-client.md)

### Web OCR

```typescript
import { createWebClient } from "docling-sdk/web";

const client = createWebClient({ device: "webgpu" });
await client.initialize();

const result = await client.processImage(imageFile);
console.log(result.markdown);
client.destroy();
```

[Full Web Client guide](./docs/web-client.md)

## Feature Matrix

| Feature | API | CLI | Web |
|---------|-----|-----|-----|
| Document conversion (PDF, DOCX, PPTX, HTML, images, ...) | Yes | Yes | Yes |
| Output formats (Markdown, JSON, HTML, text, DocTags) | Yes | Yes | Yes |
| Streaming (content, ZIP, input) | Yes | -- | -- |
| Async tasks with progress | Yes | -- | -- |
| Document chunking (RAG) | Yes | -- | -- |
| S3 integration | Yes | -- | -- |
| VLM pipeline | Yes | Yes | -- |
| ASR pipeline | -- | Yes | -- |
| Batch processing | -- | Yes | -- |
| Directory watching | -- | Yes | -- |
| Browser-based OCR (no server) | -- | -- | Yes |
| WebSocket progress tracking | Yes | -- | -- |

## Documentation

### Guides

- [Getting Started](./docs/getting-started.md) -- installation, prerequisites, first conversion
- [Configuration](./docs/configuration.md) -- all config options for API, CLI, and Web clients
- [Error Handling](./docs/error-handling.md) -- error hierarchy, retry logic, Result pattern
- [TypeScript](./docs/typescript.md) -- type guards, Result types, OpenAPI types, Zod validation

### Client Guides

- [API Client](./docs/api-client.md) -- HTTP client for Docling Serve
- [CLI Client](./docs/cli-client.md) -- Python CLI wrapper
- [Web Client](./docs/web-client.md) -- browser-based OCR

### Feature Guides

- [Document Chunking](./docs/chunking.md) -- HybridChunker and HierarchicalChunker for RAG
- [Async and Progress](./docs/async-progress.md) -- async tasks, polling, WebSocket
- [Streaming](./docs/streaming.md) -- content, ZIP, and input streaming
- [S3 Integration](./docs/s3-integration.md) -- S3 source and target operations
- [VLM Pipeline](./docs/vlm-pipeline.md) -- Vision Language Model and ASR pipelines
- [Cross-Runtime](./docs/cross-runtime.md) -- Node.js, Bun, Deno, Browser, CF Workers

### Reference

- [API Reference](./docs/api-reference.md) -- method-by-method reference
- [Migration Guide](./docs/migration.md) -- v1.x to v2.0 migration
- [Examples](./docs/examples.md) -- annotated guide to all examples

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | >= 18.0.0 |
| TypeScript (optional) | >= 4.9.0 |
| Docling Serve (API mode) | Latest |
| Python Docling (CLI mode) | Latest |
| WebGPU/WASM (Web mode) | Chrome 113+ or WASM fallback |

## Contributing

Contributions are welcome. Please read the [Contributing Guide](CONTRIBUTING.md) for details.

## License

BSD 3-Clause License -- see [LICENSE](LICENSE) for details.

## Related Projects

- [Docling](https://github.com/DS4SD/docling) -- the main Python library
- [Docling Serve](https://github.com/DS4SD/docling-serve) -- REST API server
- [Docling TS](https://github.com/DS4SD/docling-ts) -- TypeScript types and components
