# API Reference

[Home](../README.md) > [Docs](./README.md) > API Reference

Method-by-method reference for all three client types.

---

## Factory Functions

### Docling(config)

Creates an API, CLI, or Web client based on the config key:

```typescript
new Docling({ api: { baseUrl } })  // -> DoclingAPIClient
new Docling({ cli: { outputDir } }) // -> DoclingCLIClient
new Docling({ web: { device } })    // -> DoclingWebClient
```

### createAPIClient(baseUrl, options?)

```typescript
function createAPIClient(
  baseUrl: string,
  options?: Partial<Omit<DoclingAPIConfig, "type" | "baseUrl">>
): DoclingAPIClient
```

### createCLIClient(options?)

```typescript
function createCLIClient(
  options?: Partial<Omit<DoclingCLIConfig, "type">>
): DoclingCLIClient
```

### createWebClient(options?)

```typescript
function createWebClient(
  options?: Partial<Omit<DoclingWebClientConfig, "type">>
): DoclingWebClient
```

---

## DoclingAPIClient

### Health

| Method | Signature | Returns |
|--------|-----------|---------|
| `health` | `() => Promise<HealthCheckResponse>` | `{ status: "ok", timestamp? }` |

### Synchronous Conversion

| Method | Signature | Returns |
|--------|-----------|---------|
| `convert` | `(file, filename, options?, progress?) => Promise<ConvertDocumentResponse>` | Document with content |
| `convertSync` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document with content (explicit sync) |
| `convertDocument` | `(file, filename, options, progress?) => Promise<ConvertDocumentResponse>` | Document with content |
| `process` | `(file, filename, options?, progress?) => Promise<ConvertDocumentResponse>` | Document with content |

### Convenience Methods

| Method | Signature | Returns |
|--------|-----------|---------|
| `toMarkdown` | `(file, filename, options?, progress?) => Promise<ConvertDocumentResponse>` | `.document.md_content` |
| `toHtml` | `(file, filename, options?, progress?) => Promise<ConvertDocumentResponse>` | `.document.html_content` |
| `extractText` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | `.document.text_content` |

### File Upload

| Method | Signature | Returns |
|--------|-----------|---------|
| `convertFile` | `(params: FileUploadParams) => Promise<ConvertDocumentResponse>` | Document with content |
| `convertToFile` | `(file, filename, options, progress?) => Promise<ConversionFileResult>` | ZIP stream/data |

### Source Conversion

| Method | Signature | Returns |
|--------|-----------|---------|
| `convertSource` | `(request: ConvertDocumentsRequest) => Promise<ConvertDocumentResponse \| PresignedUrlConvertDocumentResponse>` | Depends on target |
| `convertFromUrl` | `(url, options?, headers?) => Promise<ConvertDocumentResponse>` | Document |
| `convertFromFile` | `(filePath, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertFromBuffer` | `(buffer, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertFromBase64` | `(base64, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertFromS3` | `(s3Config: S3Config, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertWithTarget` | `(sources, target, options?) => Promise<TargetConversionResult>` | Target result |

### Streaming

| Method | Signature | Returns |
|--------|-----------|---------|
| `convertToStream` | `(file, filename, writable, options?) => Promise<void>` | Streams to writable |
| `convertStream` | `(inputStream, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertStreamToFile` | `(inputStream, filename, options) => Promise<ConversionFileResult>` | ZIP stream/data |

### Async Conversion

| Method | Signature | Returns |
|--------|-----------|---------|
| `convertAsync` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Auto-waits and returns |
| `convertFileAsync` | `(params: FileUploadParams) => Promise<AsyncConversionTask>` | Task object |
| `convertFileAsyncToZip` | `(params: FileUploadParams) => Promise<AsyncConversionTask>` | Task object (ZIP) |
| `convertSourceAsync` | `(request: ConvertDocumentsRequest) => Promise<AsyncConversionTask>` | Task object |
| `pollTaskStatus` | `(taskId, waitSeconds?) => Promise<TaskStatusResponse>` | Status |
| `getTaskResult` | `(taskId) => Promise<ConvertDocumentResponse \| PresignedUrlConvertDocumentResponse>` | JSON result |
| `getTaskResultFile` | `(taskId) => Promise<ConversionFileResult>` | ZIP stream/data |

### Chunking

| Method | Signature | Returns |
|--------|-----------|---------|
| `chunkHybridSync` | `(file, filename, options?) => Promise<ChunkDocumentResponse>` | Chunks |
| `chunkHierarchicalSync` | `(file, filename, options?) => Promise<ChunkDocumentResponse>` | Chunks |
| `chunkHybridAsync` | `(file, filename, options?) => Promise<ChunkDocumentResponse>` | Auto-waits |
| `chunkHierarchicalAsync` | `(file, filename, options?) => Promise<ChunkDocumentResponse>` | Auto-waits |
| `chunkHybridFileAsync` | `(params: ChunkFileUploadParams) => Promise<AsyncChunkTask>` | Task |
| `chunkHierarchicalFileAsync` | `(params: ChunkFileUploadParams) => Promise<AsyncChunkTask>` | Task |
| `chunkHybridSource` | `(request) => Promise<ChunkDocumentResponse>` | Chunks |
| `chunkHierarchicalSource` | `(request) => Promise<ChunkDocumentResponse>` | Chunks |
| `chunkHybridSourceAsync` | `(request) => Promise<AsyncChunkTask>` | Task |
| `chunkHierarchicalSourceAsync` | `(request) => Promise<AsyncChunkTask>` | Task |

### Safe Methods

| Method | Signature | Returns |
|--------|-----------|---------|
| `safeConvert` | `(file, filename, options?) => Promise<SafeConversionResult>` | `Result<ConvertDocumentResponse, ProcessingError>` |
| `safeConvertToFile` | `(file, filename, options) => Promise<SafeFileConversionResult>` | `Result<ConversionFileResult, ProcessingError>` |

### Services and Config

| Property/Method | Type | Description |
|----------------|------|-------------|
| `files` | `FileService` | Low-level file conversion service |
| `chunks` | `ChunkService` | Low-level chunking service |
| `type` | `"api"` | Client type identifier |
| `getTaskManager()` | `AsyncTaskManager` | Get underlying task manager |

---

## DoclingCLIClient

### Conversion (DoclingClientBase)

| Method | Signature | Returns |
|--------|-----------|---------|
| `convert` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `toMarkdown` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `toHtml` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `extractText` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertDocument` | `(file, filename, options) => Promise<ConvertDocumentResponse>` | Document |
| `process` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertToFile` | `(file, filename, options) => Promise<ConversionFileResult>` | ZIP |
| `safeConvert` | `(file, filename, options?) => Promise<SafeConversionResult>` | Result |
| `safeConvertToFile` | `(file, filename, options) => Promise<SafeFileConversionResult>` | Result |

### CLI-Specific

| Method | Signature | Returns |
|--------|-----------|---------|
| `batch` | `(files, options?) => Promise<{ success, results }>` | Batch results |
| `processDirectory` | `(directoryPath, options?) => Promise<{ success, results, totalFiles }>` | Directory results |
| `watch` | `(directory, options?) => Promise<void>` | Starts watcher |
| `validateFiles` | `(files) => Promise<{ valid, invalid }>` | Validation results |
| `setOutputDir` | `(dir: string) => void` | Sets output directory |
| `getConfig` | `() => DoclingCLIConfig` | Current config |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `type` | `"cli"` | Client type identifier |
| `progress` | `EventEmitter` | Progress event emitter |

---

## DoclingWebClient

### Lifecycle

| Method/Property | Signature | Description |
|-----------------|-----------|-------------|
| `initialize` | `() => Promise<void>` | Download and load the model |
| `destroy` | `() => void` | Terminate worker, release resources |
| `ready` | `boolean` | `true` after `initialize()` |
| `processing` | `boolean` | `true` during `processImage()` |

### Image OCR

| Method | Signature | Returns |
|--------|-----------|---------|
| `processImage` | `(input: ImageInput, options?: WebProcessOptions) => Promise<WebOCRResult>` | OCR result with all formats |

### Conversion (DoclingClientBase)

| Method | Signature | Returns |
|--------|-----------|---------|
| `convert` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `toMarkdown` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `toHtml` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `extractText` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertDocument` | `(file, filename, options) => Promise<ConvertDocumentResponse>` | Document |
| `process` | `(file, filename, options?) => Promise<ConvertDocumentResponse>` | Document |
| `convertToFile` | `(file, filename, options) => Promise<ConversionFileResult>` | ZIP |
| `safeConvert` | `(file, filename, options?) => Promise<SafeConversionResult>` | Result |
| `safeConvertToFile` | `(file, filename, options) => Promise<SafeFileConversionResult>` | Result |

### Events

| Method | Signature | Description |
|--------|-----------|-------------|
| `on` | `(event, callback) => this` | Subscribe to event |
| `off` | `(event, callback) => this` | Unsubscribe from event |

Events: `loading`, `ready`, `status`, `stream`, `complete`, `error`

### Cache

| Method | Signature | Returns |
|--------|-----------|---------|
| `clearCache` | `() => Promise<boolean>` | Whether cache was cleared |
| `getCacheSize` | `() => Promise<number>` | Cache size in bytes |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `type` | `"web"` | Client type identifier |

---

## Common Types

### ConvertDocumentResponse

```typescript
interface ConvertDocumentResponse {
  document: ExportDocumentResponse;
  status: ConversionStatus;       // "success" | "partial_success" | "skipped" | "failure"
  processing_time: number;
  timings?: ProcessingTimings;
  errors?: ProcessingError[];
}
```

### ExportDocumentResponse

```typescript
interface ExportDocumentResponse {
  filename: string;
  md_content?: string | null;
  json_content?: DoclingDocument | null;
  html_content?: string | null;
  text_content?: string | null;
  doctags_content?: string | null;
}
```

### ConversionFileResult

```typescript
interface ConversionFileResult {
  success: boolean;
  fileStream?: NodeReadable;
  data?: Uint8Array;
  fileMetadata?: { filename, contentType, size? };
  error?: ProcessingError;
}
```

### WebOCRResult

```typescript
interface WebOCRResult {
  raw: string;
  html: string;
  markdown: string;
  plainText: string;
  json: WebOCRDocument;
  tables: ExtractedTable[];
  overlays: ElementOverlay[];
}
```

## Related

- [API Client](./api-client.md) -- API client guide
- [CLI Client](./cli-client.md) -- CLI client guide
- [Web Client](./web-client.md) -- Web client guide
- [TypeScript](./typescript.md) -- type patterns
