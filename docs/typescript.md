# TypeScript

[Home](../README.md) > [Docs](./README.md) > TypeScript

The SDK is built with TypeScript strict mode and provides comprehensive type safety across all features.

## Type Guards

### Config type guards

Determine which client mode a config object describes:

```typescript
import { isAPIConfig, isCLIConfig, isWebConfig } from "docling-sdk";
import type { DoclingConfig } from "docling-sdk";

function handleConfig(config: DoclingConfig) {
  if (isAPIConfig(config)) {
    console.log(config.api.baseUrl); // TypeScript knows api exists
  }
  if (isCLIConfig(config)) {
    console.log(config.cli.outputDir); // TypeScript knows cli exists
  }
  if (isWebConfig(config)) {
    console.log(config.web.device); // TypeScript knows web exists
  }
}
```

### Client type guards

Narrow a client instance to its concrete type:

```typescript
import { Docling, isAPIClient, isCLIClient, isWebClient } from "docling-sdk";

const client = new Docling(config);

if (isAPIClient(client)) {
  // DoclingAPIClient -- has health(), convertFile(), etc.
  await client.health();
}

if (isCLIClient(client)) {
  // DoclingCLIClient -- has batch(), watch(), etc.
  await client.batch(["file1.pdf", "file2.pdf"]);
}

if (isWebClient(client)) {
  // DoclingWebClient -- has processImage(), initialize(), etc.
  await client.initialize();
}
```

### Conversion result type guards

```typescript
import {
  isConversionSuccess,
  isConversionFailure,
  isTargetConversionSuccess,
  hasDocumentContent,
  isPresignedUrlResponse,
} from "docling-sdk";
```

## Result Pattern

The SDK provides a `Result<T, E>` type for error handling without exceptions.

### Type definition

```typescript
type Result<T, E = Error> = Success<T> | Failure<E>;

interface Success<T> {
  readonly success: true;
  readonly data: T;
}

interface Failure<E> {
  readonly success: false;
  readonly error: E;
}
```

### Safe methods

Every client has `safeConvert` and `safeConvertToFile`:

```typescript
const result = await client.safeConvert(buffer, "doc.pdf");

if (result.success) {
  // TypeScript narrows to Success<ConvertDocumentResponse>
  console.log(result.data.document.md_content);
} else {
  // TypeScript narrows to Failure<ProcessingError>
  console.error(result.error.message);
}
```

### tryAsync utility

Wrap any async function in a Result:

```typescript
import { tryAsync } from "docling-sdk";

const result = await tryAsync(() =>
  client.convertFromUrl("https://example.com/doc.pdf")
);
```

### Creating results manually

```typescript
import { success, failure } from "docling-sdk";

function processDocument(): Result<string, Error> {
  try {
    return success("processed content");
  } catch (e) {
    return failure(e as Error);
  }
}
```

## Client Interfaces

The SDK exports interfaces for each client type:

```typescript
import type {
  DoclingClientBase,  // Base interface (convert, toMarkdown, etc.)
  DoclingAPI,          // API client interface (extends DoclingClientBase)
  DoclingCLI,          // CLI client interface (extends DoclingClientBase)
  DoclingWeb,          // Web client interface (extends DoclingClientBase)
} from "docling-sdk";
```

`DoclingClientBase` defines the shared methods:

- `convert(file, filename, options?)`
- `toMarkdown(file, filename, options?)`
- `toHtml(file, filename, options?)`
- `extractText(file, filename, options?)`
- `convertDocument(file, filename, options)`
- `process(file, filename, options?)`
- `convertToFile(file, filename, options)`
- `safeConvert(file, filename, options?)`
- `safeConvertToFile(file, filename, options)`

### Conditional client type

```typescript
import type { DoclingClient, DoclingConfig } from "docling-sdk";

// Resolves to DoclingAPI, DoclingCLI, or DoclingWeb based on config
type MyClient = DoclingClient<{ api: { baseUrl: string } }>;
// -> DoclingAPI
```

## OpenAPI Generated Types

Types are auto-generated from the Docling Serve OpenAPI specification and exported under the `OpenAPI` namespace:

```typescript
import type { OpenAPI } from "docling-sdk";

// Access endpoint types
type ConvertEndpoint = OpenAPI.paths["/v1/convert/source"];

// Access schema types
type TaskStatus = OpenAPI.components["schemas"]["TaskStatus"];
```

The generated types supplement the manually maintained types in `src/types/api.ts`. The manual types remain the primary interface.

## Zod Validation

Runtime validation using Zod schemas:

```typescript
import { ZodValidation } from "docling-sdk";

// Validate with throw
const validated = ZodValidation.validateConversionOptions({
  to_formats: ["md"],
  do_ocr: true,
});

// Safe validation (returns Zod SafeParseResult)
const result = ZodValidation.safeValidateConversionOptions(userInput);
if (result.success) {
  console.log(result.data);
} else {
  console.log(result.error.issues);
}

// Individual validators
ZodValidation.isValidInputFormat("pdf");      // true
ZodValidation.isValidOutputFormat("md");       // true
ZodValidation.isValidOcrEngine("easyocr");     // true
ZodValidation.isValidPdfBackend("dlparse_v2"); // true
ZodValidation.isValidTableMode("accurate");    // true
```

## Import Patterns

### Main entry point (`docling-sdk`)

```typescript
import {
  Docling,
  createAPIClient,
  createCLIClient,
  createWebClient,
  isAPIClient,
  isCLIClient,
  isWebClient,
} from "docling-sdk";

import type {
  DoclingConfig,
  DoclingAPIConfig,
  DoclingCLIConfig,
  DoclingAPI,
  DoclingCLI,
  DoclingWeb,
  ConversionOptions,
  ConvertDocumentResponse,
  ProgressConfig,
  ProgressUpdate,
} from "docling-sdk";
```

### CLI entry point (`docling-sdk/cli`)

```typescript
import { /* CLI-specific exports */ } from "docling-sdk/cli";
```

### Browser entry point (`docling-sdk/browser`)

A trimmed build without Node.js dependencies:

```typescript
import { Docling, createAPIClient } from "docling-sdk/browser";
```

### Web entry point (`docling-sdk/web`)

Exports the Web OCR client and utilities:

```typescript
import {
  createWebClient,
  doclingToHtml,
  doclingToMarkdown,
  doclingToPlainText,
  doclingToJson,
  extractTables,
  tableToCSV,
  extractOverlays,
  clearModelCache,
  getModelCacheSize,
  renderPdfToImages,
} from "docling-sdk/web";

import type {
  WebOCRResult,
  ImageInput,
  WebProcessOptions,
  WebClientEvents,
  ExtractedTable,
  ElementOverlay,
} from "docling-sdk/web";
```

### Worker entry point (`docling-sdk/web/worker`)

The Web Worker script for browser-based OCR:

```typescript
import "docling-sdk/web/worker";
```

### Platform entry point (`docling-sdk/platform`)

Full SDK with platform detection utilities:

```typescript
import { Docling } from "docling-sdk/platform";
```

## Related

- [Error Handling](./error-handling.md) -- error classes and validation
- [Configuration](./configuration.md) -- config type details
- [Cross-Runtime](./cross-runtime.md) -- entry points per runtime
