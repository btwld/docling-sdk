# Web Client

[Home](../README.md) > [Docs](./README.md) > Web Client

The Web client runs OCR entirely in the browser using the IBM Granite Docling 258M model via WebGPU or WASM. No server is required.

## Prerequisites

Install the required peer dependencies:

```bash
npm install @huggingface/transformers onnxruntime-web
```

For PDF support, also install:

```bash
npm install unpdf
```

### Browser support

WebGPU is the recommended backend for best performance. If WebGPU is unavailable, the client falls back to WASM.

| Backend | Performance | Compatibility |
|---------|-------------|---------------|
| `webgpu` | Fast (GPU-accelerated) | Chrome 113+, Edge 113+ |
| `wasm` | Slower (CPU-based) | All modern browsers |
| `auto` | Tries WebGPU first, falls back to WASM | All modern browsers |

## Creating the Client

```typescript
import { createWebClient } from "docling-sdk/web";

const client = createWebClient({ device: "webgpu" });
```

Or through the main factory:

```typescript
import { Docling } from "docling-sdk";

const client = new Docling({
  web: {
    device: "webgpu",
    maxNewTokens: 4096,
  },
});
```

## Lifecycle

### Initialize

Download and load the model. The first call downloads the model (~500 MB), which is then cached in IndexedDB:

```typescript
client.on("loading", ({ progress, status }) => {
  console.log(`Loading: ${Math.round(progress * 100)}% - ${status}`);
});

await client.initialize();
// client.ready === true
```

### Destroy

Terminate the Web Worker and release resources:

```typescript
client.destroy();
// client.ready === false
```

### State properties

| Property | Type | Description |
|----------|------|-------------|
| `client.ready` | `boolean` | `true` after `initialize()` completes |
| `client.processing` | `boolean` | `true` while `processImage()` is running |

## Processing Images

### Input types

`processImage` accepts several input types:

```typescript
const result = await client.processImage(input);
```

| Input type | Description |
|------------|-------------|
| `File` | File from `<input type="file">` |
| `Blob` | Binary data blob |
| `string` | Data URL or base64 string |
| `HTMLCanvasElement` | Canvas element |
| `HTMLImageElement` | Image element |
| `ImageBitmap` | Decoded image bitmap |
| `OffscreenCanvas` | Offscreen canvas |

### Options

```typescript
const result = await client.processImage(file, {
  maxNewTokens: 8192,  // Override max tokens for this call
});
```

### WebOCRResult

The result object contains all output formats:

```typescript
const result = await client.processImage(file);

result.raw;        // Raw DocTags markup
result.markdown;   // Converted Markdown
result.html;       // Converted HTML
result.plainText;  // Plain text
result.json;       // Structured WebOCRDocument
result.tables;     // Extracted tables: { headers: string[], rows: string[][] }[]
result.overlays;   // Bounding boxes: { tagType: string, bbox: {...} }[]
```

## Document Conversion

The Web client also implements `DoclingClientBase`, so you can convert PDFs (requires `unpdf` peer dependency):

```typescript
const result = await client.convert(pdfBuffer, "document.pdf", {
  to_formats: ["md"],
});

console.log(result.document.md_content);
```

Convenience methods:

```typescript
const md = await client.toMarkdown(pdfBuffer, "doc.pdf");
const html = await client.toHtml(pdfBuffer, "doc.pdf");
const text = await client.extractText(pdfBuffer, "doc.pdf");
```

## Events

Subscribe to events with `on` and unsubscribe with `off`:

```typescript
client.on("loading", ({ progress, status }) => {
  // Model download progress (0-1)
});

client.on("ready", () => {
  // Model loaded and ready
});

client.on("status", ({ status }) => {
  // Processing status updates
});

client.on("stream", ({ chunk, progress }) => {
  // Streaming tokens during inference
  process.stdout.write(chunk);
});

client.on("complete", (result) => {
  // Processing complete, result is WebOCRResult
});

client.on("error", ({ message, code }) => {
  // Error during initialization or processing
});
```

| Event | Data | When |
|-------|------|------|
| `loading` | `{ progress: number, status: string }` | During model download |
| `ready` | `undefined` | Model loaded |
| `status` | `{ status: string }` | Processing status change |
| `stream` | `{ chunk: string, progress: number }` | Token generated during inference |
| `complete` | `WebOCRResult` | Processing finished |
| `error` | `{ message: string, code?: string }` | Error occurred |

## Cache Management

The model is cached in IndexedDB after the first download:

```typescript
// Get cache size in bytes
const size = await client.getCacheSize();
console.log(`Cache: ${(size / 1024 / 1024).toFixed(1)} MB`);

// Clear the cache (forces re-download on next initialize())
const cleared = await client.clearCache();
```

## Standalone Utilities

The `docling-sdk/web` entry point exports converter and extractor functions that work without the full client:

### Converters

Convert a `WebOCRDocument` (the `.json` field of `WebOCRResult`) to different formats:

```typescript
import {
  doclingToHtml,
  doclingToMarkdown,
  doclingToPlainText,
  doclingToJson,
} from "docling-sdk/web";

const html = doclingToHtml(result.json);
const markdown = doclingToMarkdown(result.json);
const text = doclingToPlainText(result.json);
const json = doclingToJson(result.json);
```

### Extractors

Extract structured data from the document:

```typescript
import { extractTables, tableToCSV, extractOverlays } from "docling-sdk/web";

const tables = extractTables(result.json);
for (const table of tables) {
  console.log(table.headers);
  console.log(table.rows);
  console.log(tableToCSV(table));
}

const overlays = extractOverlays(result.raw);
for (const overlay of overlays) {
  console.log(overlay.tagType, overlay.bbox);
}
```

### PDF renderer

Render PDF pages to images (requires `unpdf`):

```typescript
import { renderPdfToImages } from "docling-sdk/web";

const pages = await renderPdfToImages(pdfBuffer);
for (const page of pages) {
  console.log(page.pageNumber, page.width, page.height);
  // page.dataUrl is a data URL you can pass to processImage()
}
```

### Cache utilities

```typescript
import { clearModelCache, getModelCacheSize } from "docling-sdk/web";

const size = await getModelCacheSize();
await clearModelCache();
```

## Demo Application

The repository includes a full demo application:

```bash
npm run examples:web-ocr
```

This starts a Vite dev server at `http://localhost:5173` with a drag-and-drop interface for testing the Web OCR client.

## Related

- [Getting Started](./getting-started.md) -- first Web OCR conversion
- [Configuration](./configuration.md) -- Web config options
- [Cross-Runtime](./cross-runtime.md) -- browser entry points
- [API Reference](./api-reference.md) -- full method reference
