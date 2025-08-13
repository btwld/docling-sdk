# Docling Client

A TypeScript SDK for [Docling](https://github.com/DS4SD/docling) - Bridge between the Python Docling ecosystem and JavaScript/TypeScript.

## Overview

Docling Client provides a comprehensive TypeScript interface for:

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
- ☁️ **S3 Integration**: Direct S3 source reading and target uploading
- 🤖 **VLM Pipeline**: Vision Language Model support for image analysis and description
- ⚡ **Streaming**: Memory-efficient processing with stream support
- 🛡️ **Type Safety**: Full TypeScript support with comprehensive types
- 🔄 **Unified Interface**: Same methods work for both CLI and API clients

## Installation

```bash
npm install docling-sdk
```

[![npm version](https://badge.fury.io/js/docling-sdk.svg)](https://www.npmjs.com/package/docling-sdk)
[![GitHub release](https://img.shields.io/github/release/btwld/docling-sdk.svg)](https://github.com/btwld/docling-sdk/releases)
[![npm downloads](https://img.shields.io/npm/dm/docling-sdk.svg)](https://www.npmjs.com/package/docling-sdk)

## Quick Start

### API Usage (Simple)

```typescript
import { readFile, createWriteStream } from "node:fs";
import { Docling } from "docling-sdk";

const baseUrl = process.env.DOCLING_URL || "http://localhost:5001";
const client = new Docling({ api: { baseUrl, timeout: 30000 } });

const buf = await readFile("./examples/example.pdf");

// JSON (inbody)
const json = await client.convertFile({
  files: buf,
  filename: "example.pdf",
  to_formats: ["md"],
});
console.log(json.document?.md_content?.slice(0, 100));

// ZIP (file response)
const res = await client.convertToFile(buf, "example.pdf", {
  to_formats: ["md", "json"],
});
if (res.success && res.fileStream) {
  res.fileStream.pipe(createWriteStream("./output/result.zip"));
} else {
  console.error("ZIP conversion failed:", res.error?.message);
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

## Examples (simple → advanced)

- 01-api.ts: Basic API usage (health, sync inbody, async ZIP, convertToFile)
- 02-streaming.ts: True streaming (content md and ZIP via multipart)
- 03-cli.ts: CLI flows parity
- 04-async-progress.ts: Programmatic progress polling (task.poll → task.getResult)
- 05-async-webhook.ts: Webhook trigger after completion

Run examples

- export DOCLING_URL=https://your-docling-serve.example.com
- npx tsx examples/01-api.ts
- npx tsx examples/02-streaming.ts
- npx tsx examples/03-cli.ts
- npx tsx examples/04-async-progress.ts
- WEBHOOK_URL=https://your-webhook-endpoint npx tsx examples/05-async-webhook.ts

## Advanced Features

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

## Releases

This repo uses semantic-release for automated versioning, changelog, GitHub releases, and npm publish.

- Branches:
  - main → stable releases to npm (dist-tag: latest)
  - next → prereleases (e.g., 0.0.1-dev.1) to npm (dist-tag: next)
- PRs: use Conventional Commits in PR titles (feat:, fix:, feat!: for breaking)
- CI: on push to main/next, a release is cut if commits warrant it

Setup required:

- Add NPM_TOKEN secret in GitHub (Settings → Secrets → Actions)
- The workflow uses GITHUB_TOKEN for GitHub releases

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

MIT License - see [LICENSE](LICENSE) file for details.

## Related Projects

- [Docling](https://github.com/DS4SD/docling) - The main Python library
- [Docling Serve](https://github.com/DS4SD/docling-serve) - REST API server
- [Docling TS](https://github.com/DS4SD/docling-ts) - TypeScript types and components
