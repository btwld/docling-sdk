# API Client

[Home](../README.md) > [Docs](./README.md) > API Client

The API client connects to a [Docling Serve](https://github.com/DS4SD/docling-serve) instance over HTTP. It supports synchronous and asynchronous conversion, streaming, chunking, S3 integration, and progress tracking.

## Creating the Client

```typescript
import { Docling } from "docling-sdk";

const client = new Docling({
  api: {
    baseUrl: "http://localhost:5001",
    timeout: 30000,
  },
});
```

Or use the convenience factory:

```typescript
import { createAPIClient } from "docling-sdk";

const client = createAPIClient("http://localhost:5001", {
  timeout: 30000,
  retries: 5,
  headers: { "Authorization": "Bearer token" },
});
```

## Health Check

```typescript
const health = await client.health();
// { status: "ok", timestamp: "..." }
```

## Synchronous Conversion

### convert

The primary conversion method. Calls the sync endpoint and returns the document directly:

```typescript
const result = await client.convert(buffer, "document.pdf", {
  to_formats: ["md", "json"],
});

console.log(result.document.md_content);
console.log(result.document.json_content);
console.log(result.status);           // "success"
console.log(result.processing_time);  // seconds
```

### convertSync

Explicitly calls the sync endpoint (same as `convert` without progress):

```typescript
const result = await client.convertSync(buffer, "document.pdf", {
  to_formats: ["md"],
});
```

### Convenience Methods

```typescript
// Markdown only
const md = await client.toMarkdown(buffer, "doc.pdf");
console.log(md.document.md_content);

// HTML only
const html = await client.toHtml(buffer, "doc.pdf");
console.log(html.document.html_content);

// Plain text only
const text = await client.extractText(buffer, "doc.pdf");
console.log(text.document.text_content);
```

## Converting from Different Sources

### From URL

```typescript
const result = await client.convertFromUrl(
  "https://example.com/document.pdf",
  { to_formats: ["md"] },
  { "Authorization": "Bearer token" }  // optional headers
);
```

### From file path

```typescript
const result = await client.convertFromFile("./document.pdf", {
  to_formats: ["md"],
});
```

### From buffer

```typescript
const result = await client.convertFromBuffer(buffer, "doc.pdf", {
  to_formats: ["md"],
});
```

### From base64

```typescript
const result = await client.convertFromBase64(base64String, "doc.pdf", {
  to_formats: ["md"],
});
```

### From S3

```typescript
const result = await client.convertFromS3(
  { bucket: "my-docs", key: "reports/q4.pdf", region: "us-east-1" },
  { to_formats: ["md"] }
);
```

See the [S3 Integration guide](./s3-integration.md) for full details.

### From sources (URL, file, S3)

```typescript
const result = await client.convertSource({
  sources: [
    { kind: "http", url: "https://example.com/doc.pdf" },
    { kind: "file", base64_string: base64Data, filename: "doc.pdf" },
  ],
  options: { to_formats: ["md"] },
});
```

## File Uploads

### convertFile

Upload a file buffer via multipart form:

```typescript
const result = await client.convertFile({
  files: buffer,
  filename: "document.pdf",
  to_formats: ["md", "json"],
});

console.log(result.document.md_content);
```

### convertToFile

Buffers a ZIP result, returning `fileStream` (a Node readable) when the SDK's
internal `isNode()` is true, otherwise `data` (bytes). On Deno 2.9.6, both
`isNode()` and `isDeno()` return true, so the result has `fileStream`, without
`data`. Check the actual payload rather than inferring it from the runtime name.
For a Node stream destination:

```typescript
import { createWriteStream } from "node:fs";

const result = await client.convertToFile(buffer, "doc.pdf", {
  to_formats: ["md", "json"],
});

if (result.success && result.fileStream) {
  result.fileStream.pipe(createWriteStream("./output.zip"));
}
```

The `ConversionFileResult` contains:

- `success` -- whether the conversion succeeded
- `fileStream` -- Node-compatible readable stream when internal `isNode()` is true, including on Deno 2.9.6
- `data` -- raw `Uint8Array` when internal `isNode()` is false
- `fileMetadata` -- `{ filename, contentType, size }`
- `error` -- error details on failure

## Streaming and file output

`convertToStream`, `convertStream` and `convertStreamToFile` have different
buffering and runtime behavior. A stream-shaped API does not guarantee bounded
memory. See the [transfer behavior table and Node examples](streaming.md).

## Async Conversion

### Submit and wait

```typescript
const task = await client.convertFileAsync({
  files: buffer,
  filename: "document.pdf",
  to_formats: ["md"],
});

task.on("progress", (status) => {
  console.log(status.task_status, status.task_position);
});

await task.waitForCompletion();
const result = await task.getResult();
```

### Get results

For async tasks with `target_type: "zip"` (default):

```typescript
const zip = await client.getTaskResultFile(task.taskId);
```

For async tasks with `target_type: "inbody"`:

```typescript
const json = await client.getTaskResult(task.taskId);
```

### Manual polling

```typescript
const status = await client.pollTaskStatus(task.taskId, 100);
```

See the full [Async and Progress guide](./async-progress.md) for WebSocket tracking, hybrid mode, and webhooks.

## Source and Target Operations

### Convert with target

Upload results to S3 or a presigned URL instead of returning them:

```typescript
const result = await client.convertWithTarget(
  [{ kind: "http", url: "https://example.com/doc.pdf" }],
  {
    kind: "s3",
    endpoint: "s3.us-east-1.amazonaws.com",
    bucket: "output-bucket",
    key_prefix: "converted/",
    access_key: "...",
    secret_key: "...",
  },
  { to_formats: ["md"] }
);
```

## Document Chunking

The API client exposes chunking methods directly:

```typescript
// Sync chunking
const chunks = await client.chunkHybridSync(buffer, "doc.pdf", {
  chunking_max_tokens: 200,
});

// Async chunking
const task = await client.chunkHybridFileAsync({
  files: buffer,
  filename: "doc.pdf",
  chunking_max_tokens: 150,
});
```

See the full [Chunking guide](./chunking.md) for all methods.

## Services

The API client exposes two service objects for low-level access:

```typescript
// File conversion service
client.files.convert(buffer, "doc.pdf", options);
client.files.toMarkdown(buffer, "doc.pdf", options);
client.files.toHtml(buffer, "doc.pdf", options);
client.files.extractText(buffer, "doc.pdf", options);

// Chunk service
client.chunks.chunkHybrid(buffer, "doc.pdf", options);
client.chunks.chunkHierarchical(buffer, "doc.pdf", options);
```

### Task manager

Access the underlying `AsyncTaskManager` for custom event handling:

```typescript
const taskManager = client.getTaskManager();
```

## Progress Tracking

Pass a `ProgressConfig` as the last argument to any conversion method for per-call progress tracking:

```typescript
const result = await client.convert(buffer, "doc.pdf", { to_formats: ["md"] }, {
  method: "hybrid",
  onProgress: (update) => {
    console.log(update.stage, update.percentage);
  },
});
```

## Safe methods

`safeConvert` wraps conversion rejection in a Result. `safeConvertToFile` wraps
an existing `ConversionFileResult`, so an outer success can contain an inner
failure. See [error handling](error-handling.md#result-pattern) for the contracts
and examples.

## Related

- [Configuration](./configuration.md) -- all API config options
- [Streaming](./streaming.md) -- streaming patterns
- [Async and Progress](./async-progress.md) -- async tasks and progress tracking
- [Chunking](./chunking.md) -- document chunking
- [S3 Integration](./s3-integration.md) -- S3 source and target
- [API Reference](./api-reference.md) -- full method reference
