# Docling Client Examples

A compact set of high-signal examples that cover the full surface in a minimal way.

## 🧭 Index

- 01-api.ts – Health, sync JSON/MD, async task, direct ZIP download
- 02-streaming.ts – Content streaming (MD) and true ZIP streaming
- 03-cli.ts – Minimal CLI usage: fromBuffer, fromFile, and true streaming

Each example writes to examples/output/ where relevant.

### 🚀 Basic Examples

- **[file-processing.ts](./file-processing.ts)** - Clean file processing examples

  - Read local files and show actual content results (JSON/MD)
  - ZIP file handling and streaming
  - Content comparison between API and CLI
  - Minimal logging, focused on results

- **[simple-usage.ts](./simple-usage.ts)** - Comprehensive usage demonstration

  - Both API and CLI client examples
  - File path and buffer conversion methods
  - JSON and Markdown output formats
  - Complete feature showcase

- **[quick-start.ts](./quick-start.ts)** - Quick start guide

  - Focused examples for rapid learning
  - API and CLI usage patterns
  - Export functions for reuse

- **[simple-demo.js](./simple-demo.js)** - JavaScript version

  - JavaScript implementation with detailed comments
  - Ready-to-run examples (commented for safety)
  - Common usage patterns
  - Helper functions for typical operations

- **[simple-docling-test.ts](./simple-docling-test.ts)** - Simple Docling factory test

  - Basic API and CLI client creation using Docling()
  - Health checks and simple conversions
  - Clean, minimal example

- **[test-docling-factory.ts](./test-docling-factory.ts)** - Comprehensive factory tests

  - Type safety and TypeScript inference
  - Runtime type checking
  - Error handling
  - Real conversion examples

- **[basic-api-usage.ts](./basic-api-usage.ts)** - Core API client functionality

  - Health checks using Docling() factory
  - convertFile() with FileUploadParams
  - convertFileAsync() for async processing
  - convertFromUrl() for URL-based conversion
  - Multiple output formats

- **[basic-cli-usage.ts](./basic-cli-usage.ts)** - Core CLI client functionality

  - CLI availability checks using Docling() factory
  - convert() with Buffer/string input
  - convertToStream() for memory-efficient processing
  - batch() for multiple files
  - convertFromUrl(), convertFromFile(), convertFromBuffer()

### 🌊 Advanced Examples

- **[04-streaming.ts](./04-streaming.ts)** - Memory-efficient streaming

  - True passthrough streaming
  - Transform pipelines
  - NestJS integration patterns
  - Memory usage optimization

- **[05-nestjs-integration.ts](./05-nestjs-integration.ts)** - NestJS patterns

  - Service providers
  - File upload handling
  - WebSocket progress tracking
  - Error handling

- **[06-advanced-features.ts](./06-advanced-features.ts)** - Advanced capabilities
  - Async task management
  - WebSocket real-time updates
  - Custom progress tracking
  - Error recovery and retries
  - Configuration management

### ☁️ Cloud Integration Examples

- **[integrations/aws-s3/](./integrations/aws-s3/)** - AWS S3 integration patterns

  - **[basic-upload.ts](./integrations/aws-s3/basic-upload.ts)** - Simple S3 uploads
  - **[pipeline-upload.ts](./integrations/aws-s3/pipeline-upload.ts)** - Node.js pipeline patterns
  - **[multipart-upload.ts](./integrations/aws-s3/multipart-upload.ts)** - Large file handling
  - **[streaming-upload.ts](./integrations/aws-s3/streaming-upload.ts)** - True streaming uploads
  - Zero memory buffering, production-ready patterns
  - Demonstrates cloud-agnostic design principles
  - Requires AWS SDK as dev dependency (optional peer dependency)

## 🏃‍♂️ Running Examples

### Prerequisites

1. **For API examples**: Ensure Docling API server is running

   ```bash
   # Start local Docling server
   docker run -p 5001:5001 docling/docling-serve
   ```

2. **For CLI examples**: Install Docling CLI
   ```bash
   pip install docling
   ```

### CLI prerequisites

- Install Docling CLI (Python):
  - pip install docling
- Ensure the binary is available in PATH (docling)
- If Python or Docling aren’t on PATH, set in config when creating the client:
  - new Docling({ cli: { pythonPath: "/usr/local/bin/python3", doclingPath: "/usr/local/bin/docling" }})
- Alternatively, export environment variables so child processes inherit them:
  - export PYTHONPATH=/custom/python
  - export PATH=$PATH:/custom/docling/bin

### Run Examples

````bash
npx tsx examples/01-api.ts

npx tsx examples/02-streaming.ts

### ☁️ AWS S3 Upload (snippet)

```ts
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Docling } from "docling-sdk";

const client = new Docling({ api: { baseUrl: process.env.DOCLING_URL! } });
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

const res = await client.convertToFile(Buffer.from("# Hello"), "doc.md", {
  to_formats: ["md", "json"],
});
if (!res.success || !res.fileStream)
  throw new Error(res.error?.message || "no stream");

const upload = new Upload({
  client: s3,
  params: {
    Bucket: process.env.AWS_BUCKET!,
    Key: process.env.AWS_KEY || "converted/doc.zip",
    Body: res.fileStream, // Node readable stream
    ContentType: "application/zip",
  },
});
await upload.done();
````

Required env vars: DOCLING_URL, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_BUCKET.

### Run All Examples

### ☁️ AWS S3 Upload (snippet)

```ts
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Docling } from "docling-sdk";

const client = new Docling({ api: { baseUrl: process.env.DOCLING_URL! } });
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

const res = await client.convertToFile(Buffer.from("# Hello"), "doc.md", {
  to_formats: ["md", "json"],
});
if (!res.success || !res.fileStream)
  throw new Error(res.error?.message || "no stream");

const upload = new Upload({
  client: s3,
  params: {
    Bucket: process.env.AWS_BUCKET!,
    Key: process.env.AWS_KEY || "converted/doc.zip",
    Body: res.fileStream,
    ContentType: "application/zip",
  },
});
await upload.done();
```

Required env vars: DOCLING_URL, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_BUCKET.

```bash
# Run all examples in sequence
for example in examples/*.ts; do
  echo "Running $example..."
  npx tsx "$example"
done
```

## 📂 Output Files

Each example creates its own output directory:

- `examples/01-basic-api/output/` - API conversion results
- `examples/02-basic-cli/output/` - CLI conversion results
- `examples/03-unified-client/output/` - Unified client results
- `examples/04-streaming/output/` - Streaming examples
- `examples/05-nestjs-integration/output/` - NestJS integration results
- `examples/06-advanced-features/output/` - Advanced feature demonstrations

> **Note**: Output directories are automatically created and are ignored by git (see `.gitignore`).

## 🔧 Configuration

Examples use these default configurations:

### API Client

```typescript
new Docling({
  api: {
    baseUrl: "http://localhost:5001",
    timeout: 60000,
    retries: 3,
  },
});
```

### CLI Client

```typescript
new Docling({
  cli: {
    outputDir: "./output",
    timeout: 300000,
    pythonPath: "python3",
  },
});
```

## 🎯 Key Features Demonstrated

- ✅ **Type Safety** - Full TypeScript support with proper typing
- ✅ **Unified Interface** - Same methods work with API and CLI
- ✅ **Streaming** - Memory-efficient processing for large files
- ✅ **Progress Tracking** - Real-time conversion progress
- ✅ **Error Handling** - Robust error recovery and retries
- ✅ **NestJS Integration** - Production-ready patterns
- ✅ **Async Processing** - Background task management
- ✅ **Multiple Formats** - Support for MD, HTML, JSON output
- ✅ **Batch Processing** - Efficient multi-file handling
- ✅ **WebSocket Support** - Real-time updates

## 🚨 Troubleshooting

### API Examples Failing

- Ensure Docling API server is running on `http://localhost:5001`
- Check network connectivity
- Verify API server health: `curl http://localhost:5001/health`

### CLI Examples Failing

- Install Docling: `pip install docling`
- Verify installation: `docling --version`
- Check Python path in configuration

### Permission Errors

- Ensure write permissions for output directories
- Run with appropriate user permissions

## 📚 Learn More

- [Main Documentation](../README.md)
- [API Reference](../docs/api.md)
- [CLI Reference](../docs/cli.md)
- [TypeScript Types](../src/types/)
