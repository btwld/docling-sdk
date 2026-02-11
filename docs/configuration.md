# Configuration

[Home](../README.md) > [Docs](./README.md) > Configuration

The SDK uses a discriminated union for configuration. Pass an object with exactly one of the `api`, `cli`, or `web` keys to select the client mode.

```typescript
import { Docling } from "docling-sdk";

// API mode
const apiClient = new Docling({ api: { baseUrl: "http://localhost:5001" } });

// CLI mode
const cliClient = new Docling({ cli: { outputDir: "./output" } });

// Web mode
const webClient = new Docling({ web: { device: "webgpu" } });
```

---

## API Configuration

```typescript
const client = new Docling({
  api: {
    baseUrl: "http://localhost:5001",  // Required
    apiKey: "your-api-key",            // Sent as X-Api-Key header
    timeout: 60000,                    // Request timeout in ms (default: 60000)
    retries: 3,                        // Retry count (default: 3)
    headers: {                         // Additional HTTP headers
      "Authorization": "Bearer token",
    },
  },
  progress: { /* see Progress Config below */ },
  // ...shared config
});
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseUrl` | `string` | -- | Docling Serve URL (required) |
| `apiKey` | `string` | -- | API key, sent as `X-Api-Key` header |
| `timeout` | `number` | `60000` | Request timeout in milliseconds |
| `retries` | `number` | `3` | Number of retry attempts on failure |
| `headers` | `Record<string, string>` | -- | Additional HTTP headers |

### Convenience factory

```typescript
import { createAPIClient } from "docling-sdk";

const client = createAPIClient("http://localhost:5001", {
  timeout: 30000,
  retries: 5,
});
```

---

## CLI Configuration

```typescript
const client = new Docling({
  cli: {
    outputDir: "./output",       // Output directory for converted files
    verbose: true,               // Enable verbose CLI output
    progressBar: true,           // Show CLI progress bar
    tempDir: "/tmp/docling",     // Temporary directory
    concurrency: 4,              // Max concurrent conversions
  },
  // ...shared config
});
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `outputDir` | `string` | `"./output"` | Output directory for converted files |
| `verbose` | `boolean` | `false` | Enable verbose CLI output |
| `progressBar` | `boolean` | `false` | Show progress bar in CLI output |
| `tempDir` | `string` | OS temp dir | Directory for temporary files |
| `concurrency` | `number` | -- | Max parallel CLI processes |

The internal `DoclingCLIConfig` also supports `pythonPath` and `doclingPath` for custom binary locations.

### Convenience factory

```typescript
import { createCLIClient } from "docling-sdk";

const client = createCLIClient({
  outputDir: "./converted",
  verbose: true,
});
```

---

## Web Configuration

```typescript
const client = new Docling({
  web: {
    device: "webgpu",                                    // "webgpu" | "wasm" | "auto"
    modelId: "onnx-community/granite-docling-258M-ONNX", // HuggingFace model ID
    maxNewTokens: 4096,                                  // Max tokens per inference
    workerUrl: "/custom-worker.js",                      // Custom worker URL
    wasmPaths: {},                                       // Custom WASM binary paths
  },
});
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `device` | `"webgpu" \| "wasm" \| "auto"` | `"webgpu"` | Inference backend |
| `modelId` | `string` | `"onnx-community/granite-docling-258M-ONNX"` | HuggingFace model ID |
| `maxNewTokens` | `number` | `4096` | Maximum tokens generated per inference |
| `workerUrl` | `string` | auto-generated | Custom Web Worker URL |
| `wasmPaths` | `Record<string, string>` | -- | Custom WASM binary paths |

### Convenience factory

```typescript
import { createWebClient } from "docling-sdk/web";

const client = createWebClient({ device: "webgpu" });
```

---

## Shared Configuration

The following options apply to both API and CLI clients (not Web):

```typescript
const client = new Docling({
  api: { baseUrl: "http://localhost:5001" },

  // Shared options
  defaultOptions: { to_formats: ["md"] },
  retries: 3,
  timeout: 60000,
  waitSeconds: 100,
  pollingRetries: 5,

  ocr_engine: "easyocr",
  pdf_backend: "dlparse_v2",
  table_mode: "accurate",
  pipeline: "standard",

  accelerator_options: { device: "auto", num_threads: 4 },
  layout_options: { create_orphan_clusters: false },
});
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultOptions` | `ConversionOptions` | -- | Default conversion options merged into every call |
| `retries` | `number` | -- | Default retry count |
| `timeout` | `number` | -- | Default timeout in ms |
| `waitSeconds` | `number` | `100` | Long-polling wait time in seconds |
| `pollingRetries` | `number` | `5` | Max retries for polling failures |
| `ocr_engine` | `OcrEngine` | -- | Default OCR engine |
| `ocr_options` | `OcrOptions` | -- | OCR engine-specific options |
| `pdf_backend` | `PdfBackend` | -- | PDF parsing backend |
| `table_mode` | `TableMode` | -- | Table extraction mode (`"fast"` or `"accurate"`) |
| `pipeline` | `ProcessingPipeline` | -- | Processing pipeline (`"standard"`, `"vlm"`, `"asr"`) |
| `accelerator_options` | `AcceleratorOptions` | -- | GPU/CPU device and thread config |
| `layout_options` | `LayoutOptions` | -- | Layout model configuration |

---

## ConversionOptions

`ConversionOptions` controls how documents are processed. Pass these to any conversion method:

```typescript
const result = await client.convert(buffer, "doc.pdf", {
  to_formats: ["md", "json"],
  do_ocr: true,
  pipeline: "standard",
});
```

### Format options

| Field | Type | Description |
|-------|------|-------------|
| `from_formats` | `InputFormat[]` | Restrict accepted input formats |
| `to_formats` | `OutputFormat[]` | Output formats: `"md"`, `"json"`, `"html"`, `"html_split_page"`, `"text"`, `"doctags"` |
| `pipeline` | `ProcessingPipeline` | `"standard"`, `"vlm"`, or `"asr"` |
| `page_range` | `[number, number]` | Process only pages in this range (1-based) |

### OCR options

| Field | Type | Description |
|-------|------|-------------|
| `do_ocr` | `boolean` | Enable OCR processing |
| `force_ocr` | `boolean` | Force OCR even on text-based documents |
| `ocr_engine` | `OcrEngine` | `"easyocr"`, `"tesserocr"`, `"tesseract"`, `"rapidocr"`, `"ocrmac"` |
| `ocr_lang` | `string[]` | OCR languages (e.g., `["en", "de"]`) |
| `ocr_options` | `OcrOptions` | Engine-specific options (see type definitions) |

### PDF and table options

| Field | Type | Description |
|-------|------|-------------|
| `pdf_backend` | `PdfBackend` | `"pypdfium2"`, `"dlparse_v1"`, `"dlparse_v2"`, `"dlparse_v4"` |
| `table_mode` | `TableMode` | `"fast"` or `"accurate"` |
| `table_cell_matching` | `boolean` | Enable cell matching in tables |
| `do_table_structure` | `boolean` | Enable table structure detection |
| `table_structure_options` | `TableStructureOptions` | `{ do_cell_matching, mode }` |

### Image options

| Field | Type | Description |
|-------|------|-------------|
| `image_export_mode` | `ImageExportMode` | `"embedded"`, `"placeholder"`, `"referenced"` |
| `include_images` | `boolean` | Include images in output |
| `images_scale` | `number` | Image scaling factor (positive number) |
| `generate_page_images` | `boolean` | Generate images for each page |
| `generate_picture_images` | `boolean` | Generate images for detected pictures |

### Enrichment options

| Field | Type | Description |
|-------|------|-------------|
| `do_code_enrichment` | `boolean` | Enable code block detection |
| `do_formula_enrichment` | `boolean` | Enable formula detection |
| `do_picture_classification` | `boolean` | Classify detected pictures |
| `do_picture_description` | `boolean` | Generate descriptions for pictures |
| `picture_description_area_threshold` | `number` | Minimum area ratio (0-1) to describe a picture |
| `picture_description_local` | `PictureDescriptionLocal` | Local VLM config for picture descriptions |
| `picture_description_api` | `PictureDescriptionApi` | API-based VLM config for picture descriptions |

### VLM pipeline options

| Field | Type | Description |
|-------|------|-------------|
| `vlm_pipeline_model` | `VlmModelType` | Preset VLM model (e.g., `"smoldocling"`) |
| `vlm_pipeline_model_local` | `VlmModelLocal` | Custom local VLM model config |
| `vlm_pipeline_model_api` | `VlmModelApi` | API-based VLM model config |

See the full [VLM Pipeline guide](./vlm-pipeline.md) for details.

### Chunking options

| Field | Type | Description |
|-------|------|-------------|
| `chunking_use_markdown_tables` | `boolean` | Use markdown format for tables in chunks |
| `chunking_include_raw_text` | `boolean` | Include raw text alongside processed text |
| `chunking_max_tokens` | `number \| null` | Maximum tokens per chunk (HybridChunker only) |
| `chunking_tokenizer` | `string` | Tokenizer model name (HybridChunker only) |
| `chunking_merge_peers` | `boolean` | Merge peer elements (HybridChunker only) |

See the full [Chunking guide](./chunking.md) for details.

### Processing options

| Field | Type | Description |
|-------|------|-------------|
| `abort_on_error` | `boolean` | Stop processing on first error |
| `document_timeout` | `number` | Timeout per document in seconds |
| `md_page_break_placeholder` | `string` | Custom page break marker in markdown |
| `create_legacy_output` | `boolean` | Include legacy output format |
| `force_backend_text` | `boolean` | Force backend text extraction |
| `accelerator_options` | `AcceleratorOptions` | `{ device, num_threads }` |
| `layout_options` | `LayoutOptions` | Layout model configuration |
| `enable_remote_services` | `boolean` | Allow remote service calls |
| `allow_external_plugins` | `boolean` | Allow external plugins |
| `artifacts_path` | `string` | Path to model artifacts |

---

## Progress Configuration

Configure progress tracking for the API client (WebSocket, HTTP polling, or hybrid):

```typescript
const client = new Docling({
  api: { baseUrl: "http://localhost:5001" },
  progress: {
    method: "hybrid",           // "websocket" | "http" | "hybrid"
    websocketTimeout: 5000,     // WebSocket connection timeout in ms
    httpPollInterval: 1000,     // HTTP polling interval in ms
    onProgress: (update) => console.log(update.stage, update.percentage),
    onComplete: (result) => console.log("Done"),
    onError: (error) => console.error(error),
  },
});
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `method` | `"websocket" \| "http" \| "hybrid"` | `"hybrid"` | Progress tracking method |
| `websocketTimeout` | `number` | `5000` | WebSocket connection timeout in ms |
| `httpPollInterval` | `number` | `1000` | HTTP polling interval in ms |
| `onProgress` | `(update: ProgressUpdate) => void` | -- | Progress callback |
| `onComplete` | `(result: unknown) => void` | -- | Completion callback |
| `onError` | `(error: Error) => void` | -- | Error callback |
| `onWebhook` | `(data: Record<string, unknown>) => void` | -- | Webhook callback |

See [Async and Progress](./async-progress.md) for details on progress tracking modes.

---

## Connection Pool (Node.js)

The Node.js HTTP client uses a connection pool for performance:

```typescript
import { ConnectionPool } from "docling-sdk";
```

Default pool settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `maxSockets` | `50` | Maximum sockets per host |
| `maxFreeSockets` | `10` | Maximum idle sockets |
| `timeout` | `60000` | Unused socket timeout in ms |
| `keepAliveTimeout` | `30000` | Keep-alive timeout in ms |
| `keepAlive` | `true` | Enable keep-alive |
| `maxRequestsPerSocket` | `100` | Max requests per socket |
| `socketTimeout` | `30000` | Socket timeout in ms |

## Related

- [API Client](./api-client.md) -- using the API client
- [CLI Client](./cli-client.md) -- using the CLI client
- [Web Client](./web-client.md) -- using the Web client
