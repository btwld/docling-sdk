# CLI Client

[Home](../README.md) > [Docs](./README.md) > CLI Client

The CLI client wraps the Python [Docling](https://github.com/DS4SD/docling) command-line tool. It runs conversions locally without a server, with support for batch processing, directory watching, file validation, and automatic retry with error classification.

## Prerequisites

- Node.js >= 18
- Python 3 with Docling installed: `pip install docling`

## Creating the Client

```typescript
import { Docling } from "docling-sdk";

const client = new Docling({
  cli: {
    outputDir: "./output",
    verbose: true,
  },
});
```

Or use the convenience factory:

```typescript
import { createCLIClient } from "docling-sdk";

const client = createCLIClient({
  outputDir: "./converted-docs",
  verbose: true,
  concurrency: 4,
});
```

## Document Conversion

The CLI client implements `DoclingClientBase`, providing the same conversion interface as the API client:

### convert

```typescript
const result = await client.convert("./document.pdf", "document.pdf", {
  to_formats: ["md"],
});

console.log(result.document.md_content);
console.log(result.status);
```

### Convenience methods

```typescript
// Markdown
const md = await client.toMarkdown("./doc.pdf", "doc.pdf");

// HTML
const html = await client.toHtml("./doc.pdf", "doc.pdf");

// Plain text
const text = await client.extractText("./doc.pdf", "doc.pdf");
```

### convertToFile

Returns conversion results as a ZIP archive:

```typescript
const result = await client.convertToFile("./doc.pdf", "doc.pdf", {
  to_formats: ["md", "json"],
});

if (result.success && result.fileStream) {
  result.fileStream.pipe(createWriteStream("./output.zip"));
}
```

## CLI-Specific Features

### Batch processing

Process multiple files in parallel:

```typescript
const result = await client.batch(
  ["./file1.pdf", "./file2.pdf", "./file3.pdf"],
  {
    to_formats: ["md"],
    outputDir: "./batch-output",
    parallel: true,
    maxConcurrency: 4,
  }
);

console.log(`Success: ${result.success}`);
for (const r of result.results) {
  console.log(`${r.file}: ${r.success ? "OK" : r.error}`);
}
```

### Process directory

Convert all supported files in a directory:

```typescript
const result = await client.processDirectory("./documents", {
  to_formats: ["md"],
});

console.log(`Processed ${result.totalFiles} files`);
for (const r of result.results) {
  console.log(r.document.filename, r.status);
}
```

### Watch directory

Automatically convert files as they appear:

```typescript
await client.watch("./incoming", {
  outputDir: "./converted",
  recursive: true,
  patterns: ["*.pdf", "*.docx"],
  debounce: 1000,
});
```

### Validate files

Check which files are valid for conversion:

```typescript
const { valid, invalid } = await client.validateFiles([
  "./doc.pdf",
  "./readme.txt",
  "./missing.pdf",
]);

console.log("Valid:", valid);
for (const { file, reason } of invalid) {
  console.log(`Invalid: ${file} -- ${reason}`);
}
```

### Set output directory

```typescript
client.setOutputDir("./new-output");
```

## Error Handling

### CLI error classes

```typescript
import { CliError, CliTimeoutError, CliNotFoundError } from "docling-sdk";
```

| Class | When thrown |
|-------|------------|
| `CliError` | CLI process exits with non-zero code |
| `CliTimeoutError` | CLI process exceeds timeout |
| `CliNotFoundError` | Docling binary not found at configured path |

```typescript
try {
  await client.convert("./doc.pdf", "doc.pdf");
} catch (error) {
  if (error instanceof CliError) {
    console.log(error.exitCode);
    console.log(error.stderr);
  }
  if (error instanceof CliTimeoutError) {
    console.log("Process timed out");
  }
  if (error instanceof CliNotFoundError) {
    console.log("Install docling: pip install docling");
  }
}
```

### Error classification and retry

The CLI client classifies errors into five types and retries accordingly:

| Type | Retryable | Description |
|------|-----------|-------------|
| `transient` | Yes | Temporary failures, intermittent issues |
| `timeout` | Yes | Process timeouts |
| `resource` | Yes | Memory or disk pressure |
| `permanent` | No | Invalid input, corrupt files |
| `configuration` | No | Wrong binary path, missing Python |

Retry uses exponential backoff:

```
Delay = min(baseDelay * backoffMultiplier^attempt, maxDelay)
```

Default retry configuration:

| Setting | Default |
|---------|---------|
| `maxRetries` | 3 |
| `baseDelay` | 1000 ms |
| `maxDelay` | 30000 ms |
| `backoffMultiplier` | 2 |
| `retryableErrors` | transient, timeout, resource |

## Progress Events

The CLI client exposes a `progress` event emitter:

```typescript
client.progress.on("progress", (event) => {
  console.log(event.type);           // "start" | "progress" | "complete" | "error"
  console.log(event.file);           // current file
  console.log(event.percentage);     // overall progress
  console.log(event.eta);            // estimated time remaining (ms)
  console.log(event.currentStep);    // current processing step
  console.log(event.filesCompleted); // files completed so far
  console.log(event.totalFiles);     // total files to process
});
```

The `ProgressEvent` structure:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"start" \| "progress" \| "complete" \| "error"` | Event type |
| `file` | `string` | Current file being processed |
| `format` | `string` | Current output format |
| `percentage` | `number` | Overall progress (0-100) |
| `eta` | `number` | Estimated time remaining in ms |
| `currentStep` | `string` | Current processing step |
| `filesCompleted` | `number` | Number of files completed |
| `totalFiles` | `number` | Total number of files |
| `formatsCompleted` | `number` | Formats completed for current file |
| `totalFormats` | `number` | Total formats to generate |
| `processingTime` | `number` | Time elapsed in ms |
| `averageTimePerFile` | `number` | Average time per file in ms |
| `averageTimePerFormat` | `number` | Average time per format in ms |

## CLI Convert Options

The CLI client accepts `CliConvertOptions` which map to Docling CLI flags:

| Option | Type | CLI flag |
|--------|------|----------|
| `sources` | `string[]` | positional arguments |
| `fromFormats` | `InputFormat[]` | `--from` |
| `toFormats` | `OutputFormat[]` | `--to` |
| `output` | `string` | `--output` |
| `pipeline` | `ProcessingPipeline` | `--pipeline` |
| `vlmModel` | `CliVlmModelType` | `--vlm-model` |
| `asrModel` | `AsrModelType` | `--asr-model` |
| `ocr` | `boolean` | `--ocr` |
| `forceOcr` | `boolean` | `--force-ocr` |
| `ocrEngine` | `OcrEngine` | `--ocr-engine` |
| `ocrLang` | `string[]` | `--ocr-lang` |
| `pdfBackend` | `PdfBackend` | `--pdf-backend` |
| `tableMode` | `TableMode` | `--table-mode` |
| `imageExportMode` | `ImageExportMode` | `--image-export-mode` |
| `enrichCode` | `boolean` | `--enrich-code` |
| `enrichFormula` | `boolean` | `--enrich-formula` |
| `enrichPictureClasses` | `boolean` | `--enrich-picture-classes` |
| `enrichPictureDescriptions` | `boolean` | `--enrich-picture-descriptions` |
| `abortOnError` | `boolean` | `--abort-on-error` |
| `documentTimeout` | `number` | `--doc-timeout` |
| `numThreads` | `number` | `--num-threads` |
| `device` | `AcceleratorDevice` | `--device` |
| `verbose` | `number` | `-v` (repeated) |

## Advanced Configuration

### Custom paths

```typescript
const client = new Docling({
  cli: {
    outputDir: "./output",
  },
});

// The internal config supports:
// pythonPath: path to python3 binary (default: "python3")
// doclingPath: path to docling binary (default: "docling")
```

### Environment variables

Pass environment variables to the CLI process via the `CliExecutionOptions`:

```typescript
// Available through the internal CliConfig
{
  env: {
    DOCLING_ARTIFACTS_PATH: "/path/to/models",
    CUDA_VISIBLE_DEVICES: "0",
  },
}
```

## Safe Methods

```typescript
const result = await client.safeConvert("./doc.pdf", "doc.pdf");
if (result.success) {
  console.log(result.data.document.md_content);
} else {
  console.error(result.error.message);
}
```

## Related

- [Getting Started](./getting-started.md) -- first CLI conversion
- [Configuration](./configuration.md) -- CLI config options
- [Error Handling](./error-handling.md) -- error classes and retry logic
- [API Reference](./api-reference.md) -- full method reference
