# Streaming

[Home](../README.md) > [Docs](./README.md) > Streaming

The API client supports three streaming modes for memory-efficient document processing.

## Content Streaming

Stream converted content directly to a writable stream without holding the full result in memory:

```typescript
import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Docling } from "docling-sdk";

const client = new Docling({ api: { baseUrl: "http://localhost:5001" } });
const buffer = await readFile("./document.pdf");

await client.convertToStream(
  buffer,
  "document.pdf",
  createWriteStream("./output.md"),
  { to_formats: ["md"] }
);
```

This is useful when you need a single output format written directly to disk or piped to another process.

## ZIP Streaming

Submit a conversion asynchronously, then stream the result as a ZIP file:

```typescript
import { createReadStream, createWriteStream } from "node:fs";

const result = await client.convertStreamToFile(
  createReadStream("./document.pdf"),
  "document.pdf",
  { to_formats: ["md", "json"] }
);

if (result.success && result.fileStream) {
  result.fileStream.pipe(createWriteStream("./result.zip"));
}
```

This is the recommended approach when you need multiple output formats or when the input is a stream (e.g., from an HTTP upload).

## Input Streaming

Convert directly from a readable stream, useful for Express or NestJS file upload middleware:

```typescript
const result = await client.convertStream(
  request.file.stream,   // any ReadableStream
  "upload.pdf",
  { to_formats: ["md"] }
);

console.log(result.document.md_content);
```

## ConversionFileResult

Both `convertToFile` and `convertStreamToFile` return a `ConversionFileResult`:

```typescript
interface ConversionFileResult {
  success: boolean;
  fileStream?: NodeReadable;      // Node.js readable stream
  data?: Uint8Array;              // Raw bytes (browser, Deno, Bun)
  fileMetadata?: {
    filename: string;
    contentType: string;
    size?: number;
  };
  error?: ProcessingError;
}
```

- In Node.js, use `fileStream` (a `stream.Readable`)
- In browser, Deno, or Bun, use `data` (a `Uint8Array`)

## Cross-Runtime Patterns

### Node.js

```typescript
if (result.success && result.fileStream) {
  result.fileStream.pipe(createWriteStream("./output.zip"));
}
```

### Bun

```typescript
if (result.success && result.data) {
  await Bun.write("./output.zip", result.data);
}
```

### Deno

```typescript
if (result.success && result.data) {
  await Deno.writeFile("./output.zip", result.data);
}
```

### Browser

```typescript
if (result.success && result.data) {
  const blob = new Blob([result.data], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  // Use url for download link
}
```

## Related

- [API Client](./api-client.md) -- all conversion methods
- [Async and Progress](./async-progress.md) -- async as an alternative to streaming
- [Cross-Runtime](./cross-runtime.md) -- runtime-specific patterns
