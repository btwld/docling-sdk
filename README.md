# Docling SDK

A TypeScript SDK for [Docling](https://github.com/DS4SD/docling) - Bridge between the Python Docling ecosystem and JavaScript/TypeScript.

## Overview

Docling SDK provides a comprehensive TypeScript interface for:

- **Docling CLI**: Wrapper around the Python CLI with full TypeScript support
- **Docling Serve API**: HTTP client for the docling-serve REST API
- **Real-time Processing**: WebSocket support for async operations
- **Type Safety**: Full TypeScript types for all Docling data structures

## Features

- 🔧 **CLI Integration**: Execute Docling CLI commands from TypeScript
- 🌐 **API Client**: Full-featured HTTP client for docling-serve
- 📡 **WebSocket Support**: Real-time task monitoring and progress updates
- 📁 **File Processing**: Support for file uploads and batch processing
- 🎯 **Multiple Formats**: PDF, DOCX, PPTX, HTML, Images, CSV, XML, JSON, Audio, and more
- 📄 **Output Options**: Markdown, JSON, HTML, HTML Split Page, Text, DocTags
- 🔗 **Document Chunking**: Break documents into semantic chunks for RAG applications
- ☁️ **S3 Integration**: Direct S3 source reading and target uploading
- 🤖 **VLM Pipeline**: Vision Language Model support for image analysis and description
- ⚡ **Streaming**: Memory-efficient processing with stream support
- 🛡️ **Type Safety**: Full TypeScript support with comprehensive types
- 🔄 **Unified Interface**: Same methods work for both CLI and API modes

## Installation

### npm Registry (Recommended)

```bash
npm install docling-sdk
```

### GitHub Package Registry

```bash
npm install @btwld/docling-sdk
```

> **Note**: Both packages are identical. The GitHub Package Registry version is available for enterprise environments or as a backup distribution channel.

[![npm version](https://badge.fury.io/js/docling-sdk.svg)](https://www.npmjs.com/package/docling-sdk)
[![GitHub release](https://img.shields.io/github/release/btwld/docling-sdk.svg)](https://github.com/btwld/docling-sdk/releases)
[![npm downloads](https://img.shields.io/npm/dm/docling-sdk.svg)](https://www.npmjs.com/package/docling-sdk)
[![GitHub Package Registry](https://img.shields.io/badge/GitHub-Package%20Registry-blue?logo=github)](https://github.com/btwld/docling-sdk/packages)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/btwld/docling-sdk)
[![License](https://img.shields.io/npm/l/docling-sdk.svg)](https://github.com/btwld/docling-sdk/blob/main/LICENSE)

## Quick Start

### API Usage (Simple)

```typescript
import { readFile, createWriteStream } from "node:fs";
import { Docling } from "docling-sdk";

const baseUrl = process.env.DOCLING_URL || "http://localhost:5001";
const client = new Docling({ api: { baseUrl, timeout: 30000 } });

const buf = await readFile("./examples/example.pdf");

// JSON (inbody)
try {
  const result = await client.convertFile({
    files: buf,
    filename: "example.pdf",
    to_formats: ["md"],
  });

  console.log(result.document.md_content?.slice(0, 100));
} catch (error) {
  console.error("Conversion failed:", error.message);
}

// ZIP (file response)
const res = await client.convertToFile(buf, "example.pdf", {
  to_formats: ["md", "json"],
});
if (res.success === true && res.fileStream) {
  res.fileStream.pipe(createWriteStream("./output/result.zip"));
} else if (res.success === false) {
  console.error("ZIP conversion failed:", res.error.message);
}
```

### Streaming (Passthrough)

```typescript
import { createReadStream, createWriteStream } from "node:fs";
import { Docling } from "docling-sdk";

const baseUrl = process.env.DOCLING_URL || "http://localhost:5001";
const client = new Docling({ api: { baseUrl, timeout: 30000 } });

// Content streaming (md)
await client.convertToStream(
  await readFile("./examples/example.pdf"),
  "example.pdf",
  createWriteStream("./output/streamed.md"),
  { to_formats: ["md"] }
);

// ZIP streaming (async submit → result download)
const zip = await client.convertStreamToFile(
  createReadStream("./examples/example.pdf"),
  "example.pdf",
  { to_formats: ["md", "json"] }
);
if (zip.success && zip.fileStream) {
  zip.fileStream.pipe(createWriteStream("./output/streamed.zip"));
}
```

### Async with Progress and Webhook

```typescript
const task = await client.convertFileAsync({
  files: buf,
  filename: "example.pdf",
  to_formats: ["md"],
});
await task.waitForCompletion();
const zip = await client.getTaskResultFile(task.taskId);
if (zip.success && zip.fileStream) {
  zip.fileStream.pipe(createWriteStream("./output/async-result.zip"));
}

// Webhook
await fetch(process.env.WEBHOOK_URL!, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ task_id: task.taskId, status: "success" }),
});
```

### Async result variants: JSON vs ZIP

- If you requested `target_type: 'zip'` (default in `convertFileAsync`), use `getTaskResultFile(taskId)` to stream the ZIP:

```ts
await task.waitForCompletion();
const zip = await client.getTaskResultFile(task.taskId);
```

- If you requested `target_type: 'inbody'` (JSON async), use `getTaskResult(taskId)` to fetch JSON:

```ts
// Example using source async with JSON target
const t = await client.convertSourceAsync({
  sources: [{ kind: "http", url: "https://example.com/example.pdf" }],
  options: { to_formats: ["md"] },
  target: { kind: "inbody" },
});
await t.waitForCompletion();
const json = await client.getTaskResult(t.taskId);
console.log(json.status, Object.keys(json.document || {}));
```

### Document Chunking (Quick Start)

```typescript
import { Docling } from "docling-sdk";

const client = new Docling({
  api: { baseUrl: "http://localhost:5001" },
});

// Basic chunking with HybridChunker
const chunks = await client.chunkHybridSync(documentBuffer, "document.pdf", {
  chunking_max_tokens: 200,
  chunking_use_markdown_tables: true,
});

console.log(`Created ${chunks.chunks.length} chunks`);
chunks.chunks.forEach((chunk, i) => {
  console.log(`Chunk ${i + 1}: ${chunk.text.slice(0, 100)}...`);
});

// Async chunking with progress
const task = await client.chunkHybridFileAsync({
  files: documentBuffer,
  filename: "document.pdf",
  chunking_max_tokens: 150,
});

task.on("progress", (status) => {
  console.log(`Status: ${status.task_status}`);
});

const result = await task.waitForCompletion();
const finalChunks = await task.getResult();
```

## Examples (simple → advanced)

- 01-basic-api.ts: Basic API usage (health, sync inbody, async ZIP, convertToFile)
- 02-streaming.ts: True streaming (content md and ZIP via multipart)
- 03-async-processing.ts: Programmatic progress polling (task.poll → task.getResult)
- 04-chunking.ts: Document chunking with HybridChunker and HierarchicalChunker
- 04-cli-client.ts: CLI flows parity
- 05-chunking-quickstart.ts: Quick start guide for document chunking
- 05-s3-integration.ts: S3 source reading and target uploading
- 06-typescript-types.ts: TypeScript type usage and validation

Run examples

- export DOCLING_URL=https://your-docling-serve.example.com
- npx tsx examples/01-basic-api.ts
- npx tsx examples/02-streaming.ts
- npx tsx examples/03-async-processing.ts
- npx tsx examples/04-chunking.ts
- npx tsx examples/04-cli-client.ts
- npx tsx examples/05-chunking-quickstart.ts
- npx tsx examples/05-s3-integration.ts
- npx tsx examples/06-typescript-types.ts

## Advanced Features

### Document Chunking

Break documents into semantic chunks for RAG (Retrieval Augmented Generation) applications:

```typescript
// HybridChunker - Advanced chunking with token control
const hybridChunks = await client.chunkHybridSync(
  documentBuffer,
  "document.pdf",
  {
    chunking_max_tokens: 200,
    chunking_use_markdown_tables: true,
    chunking_include_raw_text: true,
    chunking_merge_peers: true,
  }
);

console.log(`Created ${hybridChunks.chunks.length} chunks`);
hybridChunks.chunks.forEach((chunk, i) => {
  console.log(`Chunk ${i + 1}: ${chunk.text.slice(0, 100)}...`);
  console.log(`Headings: ${chunk.headings?.join(" > ") || "None"}`);
  console.log(`Tokens: ${chunk.num_tokens || "N/A"}`);
});

// HierarchicalChunker - Structure-aware chunking
const hierarchicalChunks = await client.chunkHierarchicalSync(
  documentBuffer,
  "document.pdf",
  {
    chunking_use_markdown_tables: true,
    chunking_include_raw_text: false,
  }
);

// Async chunking with progress tracking
const chunkTask = await client.chunkHybridFileAsync({
  files: documentBuffer,
  filename: "document.pdf",
  chunking_max_tokens: 150,
});

chunkTask.on("progress", (status) => {
  console.log(`Chunking progress: ${status.task_status}`);
});

const result = await chunkTask.waitForCompletion();
const chunks = await chunkTask.getResult();

// Chunk from URL sources
const urlChunks = await client.chunkHybridSource({
  sources: [
    {
      kind: "http",
      url: "https://example.com/document.pdf",
    },
  ],
  chunking_options: {
    chunker: "hybrid",
    max_tokens: 250,
    use_markdown_tables: true,
  },
});

// Async source chunking with HierarchicalChunker
const asyncSourceTask = await client.chunkHierarchicalSourceAsync({
  sources: [
    {
      kind: "http",
      url: "https://example.com/document.pdf",
    },
  ],
  chunking_options: {
    chunker: "hierarchical",
    use_markdown_tables: true,
  },
});

const sourceResult = await asyncSourceTask.waitForCompletion();
const sourceChunks = await asyncSourceTask.getResult();
```

#### Available Chunking Methods

**Sync Methods (immediate results):**

- `chunkHybridSync(file, filename, options)` - HybridChunker sync
- `chunkHierarchicalSync(file, filename, options)` - HierarchicalChunker sync
- `chunkHybridSource(request)` - HybridChunker from sources
- `chunkHierarchicalSource(request)` - HierarchicalChunker from sources

**Async Methods (auto-completion):**

- `chunkHybridAsync(file, filename, options)` - HybridChunker async with auto-completion
- `chunkHierarchicalAsync(file, filename, options)` - HierarchicalChunker async with auto-completion

**Task-based Methods (manual control):**

- `chunkHybridFileAsync(params)` - Returns AsyncChunkTask for manual control
- `chunkHierarchicalFileAsync(params)` - Returns AsyncChunkTask for manual control
- `chunkHybridSourceAsync(request)` - Async source chunking with HybridChunker
- `chunkHierarchicalSourceAsync(request)` - Async source chunking with HierarchicalChunker

### S3 Integration

```typescript
// Convert from S3 source
const result = await client.convertFromS3(
  {
    bucket: "my-documents",
    key: "reports/annual-report.pdf",
    region: "us-east-1",
  },
  {
    to_formats: ["md"],
    do_picture_description: true,
  }
);

// Upload results to S3
const s3Result = await client.convertWithTarget(
  [{ kind: "file", base64_string: "...", filename: "doc.pdf" }],
  {
    kind: "s3",
    bucket: "output-bucket",
    key: "processed/result.zip",
    region: "us-east-1",
  },
  {}
);
```

### VLM (Vision Language Model) Pipeline

```typescript
// Use preset VLM model
const vlmResult = await client.convert(buffer, "document.pdf", {
  vlm_pipeline_model: "smoldocling",
  do_picture_description: true,
  do_picture_classification: true,
});

// Custom local VLM model
const customResult = await client.convert(buffer, "document.pdf", {
  vlm_pipeline_model_local: {
    repo_id: "microsoft/DialoGPT-medium",
    prompt: "Describe this image in detail:",
    scale: 1.0,
    response_format: "markdown",
    inference_framework: "transformers",
    transformers_model_type: "automodel-vision2seq",
    extra_generation_config: { max_length: 512 },
  },
});
```

## TypeScript Usage

The Docling SDK provides full TypeScript support with clean, direct return types for type-safe result handling.

### Clean API Pattern

The SDK uses a clean API pattern where methods return documents directly and throw errors for failures. No discriminated unions needed:

```typescript
import { Docling } from "docling-sdk";

const client = new Docling({ api: { baseUrl: "http://localhost:5001" } });

try {
  const result = await client.convert(buffer, "document.pdf");
  // Direct access to document - clean and simple!
  console.log(result.document.filename);
  console.log(result.status);
} catch (error) {
  console.error("Conversion failed:", error.message);
}

// ✅ Clean API: Direct access to document properties
console.log("Document:", result.document.filename);
console.log("Status:", result.status);
console.log("Content:", result.document.md_content?.slice(0, 100));
```

### Advanced: Safe Methods (Optional)

For scenarios where you prefer Result patterns over try/catch, safe methods are available:

```typescript
import { Docling } from "docling-sdk";

const client = new Docling({ api: { baseUrl: "http://localhost:5001" } });

// Safe methods return Result<T, E> instead of throwing
const result = await client.safeConvert(buffer, "document.pdf");

if (result.success) {
  console.log("Document:", result.data.document.filename);
} else {
  console.error("Conversion failed:", result.error.message);
}
```

> **💡 Tip**: For most applications, use the simple try/catch patterns shown above for cleaner, more readable code. Type guards are available for advanced async scenarios.

See [examples/06-typescript-types.ts](./examples/06-typescript-types.ts) for comprehensive TypeScript usage examples.

## Documentation

- [API Reference](./docs/api.md)
- [CLI Reference](./docs/cli.md)
- [Examples](./examples/)
- [Migration Guide](./docs/migration.md)

## Requirements

- Node.js >= 18.0.0
- TypeScript >= 4.9.0 (for development)
- Python Docling installation (for CLI usage)
- Docling Serve instance (for API usage)

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run linting
npm run lint

# Format code
npm run format
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

BSD 3-Clause License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [Docling](https://github.com/DS4SD/docling) - The main Python library
- [Docling Serve](https://github.com/DS4SD/docling-serve) - REST API server
- [Docling TS](https://github.com/DS4SD/docling-ts) - TypeScript types and components
