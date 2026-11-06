# CLI Client

[Home](../README.md) > [Docs](./README.md) > CLI Client

The CLI client wraps the Python [Docling](https://github.com/DS4SD/docling) command-line tool. It runs conversions locally without a server, with support for batch processing, directory watching, file validation and isolated conversion jobs.

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

Inspect `status`: it is `success` only when every requested format has validated
output, `partial_success` when some work is incomplete, and `failure` when no
requested format succeeds. Errors are retained in `result.errors`; a zero process
exit alone does not establish successful conversion. Structured `json_content`
is a parsed document object.

Each request snapshots its input and writes beneath a private job directory in
`outputDir`. Successful output paths exposed by `file-read` or completion events
belong to that job; do not assume a shared `outputDir/<basename>.md` layout.
Input snapshots and failed artifacts are removed. ZIP/stream methods consume
validated output and remove their temporary job after consumption.

The `html_split_page` format uses Python Docling's split-page HTML export and
returns `.html` content in `document.html_content` (or `outputs.html` for the
CLI-specific methods). When both HTML variants are requested, their files remain
separate in the private job and ZIP. The single HTML content field represents the
last requested HTML variant.

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

### convertToStream

`convertToStream(options, destination, returnAsZip)` validates the requested
outputs before writing content. The returned promise waits for the destination's
writable side to finish, including when conversion returns a failure result.
A destination error or premature finish stops active conversion, prevents later
formats from starting and rejects after job cleanup. For Duplex destinations,
the readable side need not finish. Rejected operations destroy the destination.

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

`outputDir` applies only to this batch; it does not change the client's output
directory. `maxConcurrency` must be a positive safe integer; invalid values reject
before any conversion starts. `parallel: false` runs one file at a time.

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

Conversion no longer retries automatically based on words in converter
diagnostics. A timeout, signal exit or message containing "temporary" does not
start another conversion. Parent SIGINT/SIGTERM rejects content/progress/stream
conversion as `ProcessAbortError`, stops later formats/sources and cleans the job.
`batch()` and `processDirectory()` also propagate cancellation; a parallel batch
waits for every started job in its current chunk to clean up before rejecting,
and starts no later chunk. Earlier completed files remain available at their
exposed paths. `convertMultipleFiles()` eagerly dispatches its inputs and retains
its per-file failure results. If its progress callback throws, the aggregate waits
for started sibling conversions to settle before rejecting. ZIP file-output
methods preserve their failure-result contract, retaining the execution error in
its details. Callers may explicitly retry after inspecting the returned
status/errors or a rejected operation.

Readiness requires a successful version probe. Executable paths and arguments
remain literal values; Python module fallback uses a Python executable plus
`-m` and a module name. Command strings containing shell syntax are unsupported.

The validated Python runtime is Docling **2.60.1**. Its CLI does not expose a
page-range flag, so unsupported `page_range` requests reject instead of pretending
to convert that subset. `document_timeout` is forwarded to Python and is not a
hard deadline: a real standard-pipeline probe exceeded that value while upstream
reported success. Configure the SDK's process `timeout` for a killable process
deadline; it includes process/model startup and is separate from the engine's
internal document timer.

Without an explicit `ocrEngine`/`ocr_engine`, the converter selects its installed
OCR backend. Standard Python Docling installations do not necessarily include
EasyOCR; the SDK no longer forces that optional engine.

CLI-specific `sources` accept files, recursively expanded directories, and HTTP(S)
URLs. Each remote source is downloaded once into the job and reused across formats;
safe response filenames take precedence over the URL basename. Directory expansion
skips discovered symlinks, output trees and owned job namespaces. Watchers likewise
ignore owned job snapshots, including when input and output share a root.

Referenced images are included in ZIPs with portable Markdown/HTML/JSON paths.
Use ZIP streaming for referenced assets; a raw text stream cannot retain temporary
asset files. Completed non-ZIP outputs remain under their reported private job
directory. These guarantees cover the validated artifact inventory, not arbitrary
external links embedded in a document.

The shared process runner tracks exit code and signal separately, bounds captured
output, and waits for cleanup before settling a timeout or abort. `CliUtils`
preserves its numeric `exitCode` contract with `-1` for a signal/no exit status,
exposes the `signal`, and accepts `signal`/`maxBuffer` execution options. POSIX
termination targets the process group; Windows tree termination is best effort.

## Progress Events

The CLI client exposes a `progress` event emitter:

```typescript
client.progress.on("enhanced-progress", (event) => {
  console.log(event.type);           // "start" | "progress" | "complete" | "error"
  console.log(event.file);           // current file
  console.log(event.percentage);     // overall progress
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
| `currentStep` | `string` | Current processing step |
| `filesCompleted` | `number` | Number of files completed |
| `totalFiles` | `number` | Total number of files |
| `formatsCompleted` | `number` | Formats completed for current file |
| `totalFormats` | `number` | Total formats to generate |
| `processingTime` | `number` | Time elapsed in ms |

Per-format activity is also available through `format-processing-start`,
`format-processing-complete` and `format-processing-error`. Completion events
carry the actual conversion status; failed/partial jobs do not emit full success.

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
