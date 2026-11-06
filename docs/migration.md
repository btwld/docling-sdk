# Migration Guide

[Home](../README.md) > [Docs](./README.md) > Migration Guide

## Optional native selection (unreleased)

Existing imports, factory behavior and Python/API/browser defaults remain unchanged. Native use is opt-in through `createNativeClient` from `docling-sdk/native`, with [separate setup and a narrow contract](native-client.md). It is not a drop-in replacement for Python batch/watch/S3/browser methods. No major default switch is part of this stack.

## v1.x to v2.0

The v2 runtime changes introduced portable binary inputs, browser entry points
and a Web OCR client. See [cross-runtime setup](cross-runtime.md) for each mode.

### Binary inputs

The API and Web clients accept `Uint8Array` for binary conversion input.
Existing Node buffers still work because `Buffer` extends `Uint8Array`.
Change explicit `Buffer` annotations when sharing API/Web code with other runtimes:

```typescript
import { createAPIClient } from "docling-sdk";

const client = createAPIClient("http://localhost:5001");
const result = await client.convert(new Uint8Array(data), "doc.pdf");
```

The CLI client, including the instance returned by `createCLIClient()`, still
requires `Buffer | string`. Use `Buffer.from(data)` for binary CLI input or pass
a file path as a string. A plain `Uint8Array` is not supported by the CLI's
conversion signatures or its input handling, which checks `Buffer.isBuffer()`.

### Entry points

```typescript
// Node: API/CLI factory
import { Docling } from "docling-sdk";

// Browser: API factory, without the Node CLI
import { createAPIClient } from "docling-sdk/browser";

// Browser-local OCR
import { createWebClient } from "docling-sdk/web";
```

The browser entry does not export `Docling`. Web OCR requires optional peers and
worker setup; PDFs additionally require `unpdf`. See the [Web guide](web-client.md).

### ESM-only publishing from v2.0.4

Use ESM `import` syntax. PR [#67](https://github.com/btwld/docling-sdk/pull/67)
removed the CommonJS build to reduce package size; older dual CJS/ESM advice is
superseded. See [ESM packaging](../ARCHITECTURE.md#esm-only-packaging).

## Earlier changes and compatibility

These are not new v2 migrations:

- Nested configuration (`{ api: { baseUrl } }` or `{ cli: { outputDir } }`) was
  already present in the initial SDK. The v2 factory adds the `web` variant.
- Ordinary conversion methods returned `ConvertDocumentResponse` directly by
  v1.3.1, following PR [#35](https://github.com/btwld/docling-sdk/pull/35).
  Use `safeConvert` when a Result wrapper is preferable to catching errors.
- `DocumentContent` remains exported as a deprecated interface. Prefer
  `ExportDocumentResponse` for new type annotations.
- Chunking, S3 and Result utilities existed before v2. The previously empty
  OpenAPI namespace now contains raw types from a pinned Serve 1.7.2 schema;
  see [TypeScript](typescript.md#openapi-types-and-adapters).

File-output methods have their own success/failure contract; Web does not
support file-output methods. See [error handling](error-handling.md#result-pattern)
and [transfer behavior](streaming.md).

## Pending correctness release

Python remains the default and all public package entry points remain. Observable
corrections include truthful partial/failure results, unique per-job CLI output
directories, shell-free literal arguments, explicit zero retry/timeout handling,
and cancellation that settles after owned cleanup. ZIPs include validated
referenced images; raw streaming with referenced assets requires ZIP output.
CLI OCR defaults now follow the installed converter instead of forcing EasyOCR.
Python 2.60.1 does not support CLI page ranges; unsupported requests reject.

TypeScript consumers need >=5.5; SDK runtime Node >=18 is unchanged. ZIP support
uses optional `fflate` loaded on demand. Browser/Bun/Deno async ZIP downloads
retain bytes. Browser OCR applications should configure a bundled `workerUrl`.
See the [validation and limitations record](review-evidence/native-conversion/release-hardening-2026-11-06.md)
before adopting paths outside the demonstrated runtime coverage.

## Related

- [Configuration](configuration.md) — client configuration
- [TypeScript](typescript.md) — public types and schema-generation status
- [Architecture decisions](../ARCHITECTURE.md) — runtime and compatibility rationale
