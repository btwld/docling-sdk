# Document Chunking

[Home](../README.md) > [Docs](./README.md) > Document Chunking

Break documents into semantic chunks for RAG (Retrieval Augmented Generation) applications. The SDK provides two chunkers through the Docling Serve API:

- **HybridChunker** -- token-aware chunking with configurable token limits, tokenizer, and peer merging
- **HierarchicalChunker** -- structure-aware chunking that preserves document hierarchy

## HybridChunker

### Synchronous

```typescript
const chunks = await client.chunkHybridSync(buffer, "document.pdf", {
  chunking_max_tokens: 200,
  chunking_use_markdown_tables: true,
  chunking_include_raw_text: true,
  chunking_merge_peers: true,
});

console.log(`Created ${chunks.chunks.length} chunks`);
for (const chunk of chunks.chunks) {
  console.log(chunk.text.slice(0, 100));
  console.log(`Tokens: ${chunk.num_tokens}`);
  console.log(`Headings: ${chunk.headings?.join(" > ")}`);
}
```

### Asynchronous (auto-completion)

Submits async, waits for completion, and returns the result:

```typescript
const chunks = await client.chunkHybridAsync(buffer, "document.pdf", {
  chunking_max_tokens: 200,
});
```

### Task-based (manual control)

Returns an `AsyncChunkTask` for progress tracking and manual polling:

```typescript
const task = await client.chunkHybridFileAsync({
  files: buffer,
  filename: "document.pdf",
  chunking_max_tokens: 150,
});

task.on("progress", (status) => {
  console.log(`Status: ${status.task_status}`);
});

await task.waitForCompletion();
const chunks = await task.getResult();
```

## HierarchicalChunker

### Synchronous

```typescript
const chunks = await client.chunkHierarchicalSync(buffer, "document.pdf", {
  chunking_use_markdown_tables: true,
  chunking_include_raw_text: false,
});
```

### Asynchronous (auto-completion)

```typescript
const chunks = await client.chunkHierarchicalAsync(buffer, "document.pdf", {
  chunking_use_markdown_tables: true,
});
```

### Task-based (manual control)

```typescript
const task = await client.chunkHierarchicalFileAsync({
  files: buffer,
  filename: "document.pdf",
});

await task.waitForCompletion();
const chunks = await task.getResult();
```

## Source-Based Chunking

Chunk documents from URLs or other sources without uploading files:

### HybridChunker from sources

```typescript
const chunks = await client.chunkHybridSource({
  sources: [
    { kind: "http", url: "https://example.com/document.pdf" },
  ],
  chunking_options: {
    chunker: "hybrid",
    max_tokens: 250,
    use_markdown_tables: true,
  },
});
```

### HierarchicalChunker from sources

```typescript
const chunks = await client.chunkHierarchicalSource({
  sources: [
    { kind: "http", url: "https://example.com/document.pdf" },
  ],
  chunking_options: {
    chunker: "hierarchical",
    use_markdown_tables: true,
  },
});
```

### Async source chunking

```typescript
const task = await client.chunkHybridSourceAsync({
  sources: [{ kind: "http", url: "https://example.com/doc.pdf" }],
  chunking_options: { chunker: "hybrid", max_tokens: 200 },
});

await task.waitForCompletion();
const chunks = await task.getResult();
```

```typescript
const task = await client.chunkHierarchicalSourceAsync({
  sources: [{ kind: "http", url: "https://example.com/doc.pdf" }],
  chunking_options: { chunker: "hierarchical" },
});

await task.waitForCompletion();
const chunks = await task.getResult();
```

## Chunk Result

### ChunkDocumentResponse

```typescript
interface ChunkDocumentResponse {
  chunks: ChunkedDocumentResultItem[];
  documents: ExportResult[];
  processing_time: number;
}
```

### ChunkedDocumentResultItem

Each chunk contains:

| Field | Type | Description |
|-------|------|-------------|
| `filename` | `string` | Source document filename |
| `chunk_index` | `number` | Zero-based index of this chunk |
| `text` | `string` | Processed chunk text |
| `raw_text` | `string \| null` | Raw text (if `include_raw_text` is true) |
| `num_tokens` | `number \| null` | Token count (HybridChunker only) |
| `headings` | `string[] \| null` | Document headings leading to this chunk |
| `captions` | `string[] \| null` | Associated captions |
| `doc_items` | `string[]` | Referenced document item IDs |
| `page_numbers` | `number[] \| null` | Source page numbers |
| `metadata` | `Record<string, unknown> \| null` | Additional metadata |

## AsyncChunkTask

The async chunk task supports events:

```typescript
const task = await client.chunkHybridFileAsync({ files: buffer, filename: "doc.pdf" });

task.on("progress", (status) => { /* TaskStatusResponse */ });
task.on("complete", (result) => { /* ChunkDocumentResponse */ });
task.on("error", (error) => { /* ProcessingError */ });

// Properties
task.taskId;    // string
task.status;    // "pending" | "started" | "success" | "failure"
task.position;  // queue position
task.meta;      // task metadata

// Methods
await task.poll();                // manual poll
await task.waitForCompletion();   // wait until done
const result = await task.getResult();  // get final result
```

## Chunking Options Reference

### Via ConversionOptions (file uploads)

| Option | Type | Default | Chunker |
|--------|------|---------|---------|
| `chunking_max_tokens` | `number \| null` | -- | Hybrid only |
| `chunking_tokenizer` | `string` | -- | Hybrid only |
| `chunking_merge_peers` | `boolean` | -- | Hybrid only |
| `chunking_use_markdown_tables` | `boolean` | -- | Both |
| `chunking_include_raw_text` | `boolean` | -- | Both |

### Via source request chunking_options

| Option | Type | Default | Chunker |
|--------|------|---------|---------|
| `chunker` | `"hybrid" \| "hierarchical"` | -- | Selector |
| `max_tokens` | `number \| null` | -- | Hybrid only |
| `tokenizer` | `string` | -- | Hybrid only |
| `merge_peers` | `boolean` | -- | Hybrid only |
| `use_markdown_tables` | `boolean` | -- | Both |
| `include_raw_text` | `boolean` | -- | Both |

## Method Summary

**Synchronous (immediate results):**
- `chunkHybridSync(file, filename, options)`
- `chunkHierarchicalSync(file, filename, options)`
- `chunkHybridSource(request)`
- `chunkHierarchicalSource(request)`

**Asynchronous (auto-completion):**
- `chunkHybridAsync(file, filename, options)`
- `chunkHierarchicalAsync(file, filename, options)`

**Task-based (manual control):**
- `chunkHybridFileAsync(params)` -- returns `AsyncChunkTask`
- `chunkHierarchicalFileAsync(params)` -- returns `AsyncChunkTask`
- `chunkHybridSourceAsync(request)` -- returns `AsyncChunkTask`
- `chunkHierarchicalSourceAsync(request)` -- returns `AsyncChunkTask`

## RAG Integration

A typical pattern for feeding chunks into a vector database:

```typescript
const chunks = await client.chunkHybridSync(buffer, "doc.pdf", {
  chunking_max_tokens: 512,
  chunking_use_markdown_tables: true,
  chunking_merge_peers: true,
});

for (const chunk of chunks.chunks) {
  await vectorDb.upsert({
    id: `${chunk.filename}-${chunk.chunk_index}`,
    text: chunk.text,
    metadata: {
      filename: chunk.filename,
      headings: chunk.headings,
      pages: chunk.page_numbers,
      tokens: chunk.num_tokens,
    },
  });
}
```

## Related

- [API Client](./api-client.md) -- chunking methods on the API client
- [Async and Progress](./async-progress.md) -- async task handling
- [API Reference](./api-reference.md) -- method signatures
