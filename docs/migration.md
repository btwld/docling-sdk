# Migration Guide

[Home](../README.md) > [Docs](./README.md) > Migration Guide

## v1.x to v2.0

The v2 runtime changes introduced portable binary inputs, browser entry points
and a Web OCR client. See [cross-runtime setup](cross-runtime.md) for each mode.

### Binary inputs

Public conversion signatures use `Uint8Array` in place of Node's `Buffer`.
Existing Node buffers still work because `Buffer` extends `Uint8Array`.
Change explicit `Buffer` annotations when sharing code with other runtimes:

```typescript
const result = await client.convert(new Uint8Array(data), "doc.pdf");
```

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
- Chunking, S3 and Result utilities existed before v2. The OpenAPI namespace
  remains a placeholder rather than populated endpoint types.

File-output methods have their own success/failure contract; Web does not
support file-output methods. See [error handling](error-handling.md#result-pattern)
and [transfer behavior](streaming.md).

## Related

- [Configuration](configuration.md) — client configuration
- [TypeScript](typescript.md) — public types and schema-generation status
- [Architecture decisions](../ARCHITECTURE.md) — runtime and compatibility rationale
