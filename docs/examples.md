# Examples

[Home](../README.md) > [Docs](./README.md) > Examples

The `examples/` directory contains runnable scripts demonstrating SDK features.

## Running Examples

Set the `DOCLING_URL` environment variable to point to your Docling Serve instance:

```bash
export DOCLING_URL=http://localhost:5001
```

Run any example with `tsx`:

```bash
npx tsx examples/01-basic-api.ts
```

Or use the predefined npm scripts:

```bash
npm run examples:basic-api
npm run examples:streaming
npm run examples:async
npm run examples:cli
npm run examples:s3
npm run examples:typescript
```

## Core Examples

### 01-basic-api.ts

**Key concepts**: health check, synchronous conversion, async conversion with ZIP output, `convertToFile`

Demonstrates the fundamental API client workflow: check server health, convert a PDF to markdown (sync inbody response), submit an async conversion and download the ZIP result, and use `convertToFile` for file-based output.

```bash
npx tsx examples/01-basic-api.ts
```

### 02-streaming.ts

**Key concepts**: `convertToStream`, `convertStreamToFile`, content streaming, ZIP streaming

Shows memory-efficient processing by streaming converted content directly to disk and streaming ZIP results from async submissions.

```bash
npx tsx examples/02-streaming.ts
```

### 03-async-processing.ts

**Key concepts**: `convertFileAsync`, `task.poll()`, `task.getResult()`, manual polling

Demonstrates programmatic control over async tasks: submit a conversion, manually poll for status updates, and retrieve results when complete.

```bash
npx tsx examples/03-async-processing.ts
```

### 04-chunking.ts

**Key concepts**: `chunkHybridSync`, `chunkHierarchicalSync`, `chunkHybridFileAsync`, chunk options

Shows both chunker types (HybridChunker and HierarchicalChunker) with sync and async modes, including source-based chunking from URLs.

```bash
npx tsx examples/04-chunking.ts
```

### 04-cli-client.ts

**Key concepts**: `DoclingCLIClient`, `convert`, `batch`, `processDirectory`, progress events

Demonstrates CLI client features: single file conversion, batch processing, directory processing, and progress tracking through the event emitter.

```bash
npx tsx examples/04-cli-client.ts
```

### 05-chunking-quickstart.ts

**Key concepts**: quick-start chunking workflow, basic options

A minimal chunking example showing the fastest path from document to chunks.

```bash
npx tsx examples/05-chunking-quickstart.ts
```

### 05-s3-integration.ts

**Key concepts**: `convertFromS3`, `convertWithTarget`, S3Config, S3 target

Demonstrates reading documents from S3 and uploading conversion results to S3.

```bash
npx tsx examples/05-s3-integration.ts
```

### 06-typescript-types.ts

**Key concepts**: type guards, Result pattern, `safeConvert`, OpenAPI types, Zod validation

A comprehensive TypeScript usage example showing type-safe patterns, discriminated unions, Result types, and validation.

```bash
npx tsx examples/06-typescript-types.ts
```

## Runtime Examples

### Node.js

```bash
npx tsx examples/runtimes/node.ts
# or: npm run examples:node
```

Demonstrates Node.js-specific features: file system access, `stream.pipe()`, connection pooling.

### Bun

```bash
bun run examples/runtimes/bun.ts
# or: npm run examples:bun
```

Demonstrates `Bun.file()` for input and `Bun.write()` for output.

### Deno

```bash
deno run --allow-net --allow-env --allow-read examples/runtimes/deno.ts
# or: npm run examples:deno
```

Demonstrates `npm:` imports, `Deno.readFile()`, and `Deno.writeFile()`.

### Browser

```bash
vite examples/runtimes/browser
# or: npm run examples:browser
```

Demonstrates browser-based API client usage with file input and the `docling-sdk/browser` entry point.

### Cloudflare Worker

```bash
cd examples/runtimes/cloudflare-worker && wrangler dev
# or: npm run examples:worker
```

Demonstrates a Cloudflare Worker that accepts file uploads and returns converted markdown.

## Web OCR Demo

```bash
npm run examples:web-ocr
```

Opens a full demo application at `http://localhost:5173` with:
- Drag-and-drop file input
- WebGPU/WASM backend selection
- Real-time streaming output
- Model loading progress
- Multiple output formats (Markdown, HTML, JSON, tables, overlays)

The demo source is in `examples/web-ocr/`.

## Related

- [Getting Started](./getting-started.md) -- first conversion
- [API Client](./api-client.md) -- API client guide
- [CLI Client](./cli-client.md) -- CLI client guide
- [Web Client](./web-client.md) -- Web OCR guide
