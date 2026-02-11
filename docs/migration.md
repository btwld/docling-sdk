# Migration Guide

[Home](../README.md) > [Docs](./README.md) > Migration Guide

## v1.x to v2.0

### Breaking Changes

#### Configuration format

The configuration format changed from a flat object to a discriminated union:

```typescript
// v1.x
const client = new Docling({
  type: "api",
  baseUrl: "http://localhost:5001",
  timeout: 30000,
});

// v2.0
const client = new Docling({
  api: {
    baseUrl: "http://localhost:5001",
    timeout: 30000,
  },
});
```

```typescript
// v1.x
const client = new Docling({
  type: "cli",
  outputDir: "./output",
});

// v2.0
const client = new Docling({
  cli: {
    outputDir: "./output",
  },
});
```

#### Buffer to Uint8Array

All binary data parameters now use `Uint8Array` instead of Node.js `Buffer`:

```typescript
// v1.x
const result = await client.convert(Buffer.from(data), "doc.pdf");

// v2.0
const result = await client.convert(new Uint8Array(data), "doc.pdf");
```

`Buffer` is a subclass of `Uint8Array` in Node.js, so existing code using `Buffer` will continue to work. However, the type signatures now specify `Uint8Array` for cross-runtime compatibility.

#### Entry points

The SDK now uses subpath exports for different runtimes:

```typescript
// v1.x
import { Docling } from "docling-sdk";

// v2.0 -- same for most uses
import { Docling } from "docling-sdk";

// v2.0 -- new entry points for specific contexts
import { Docling } from "docling-sdk/browser";     // Browser builds
import { createWebClient } from "docling-sdk/web";  // Web OCR
import "docling-sdk/web/worker";                     // Web Worker
```

#### Conversion results

Methods now return documents directly and throw on error, instead of returning discriminated union results:

```typescript
// v1.x
const result = await client.convert(buffer, "doc.pdf");
if (result.success) {
  console.log(result.data.document.md_content);
} else {
  console.error(result.error.message);
}

// v2.0
try {
  const result = await client.convert(buffer, "doc.pdf");
  console.log(result.document.md_content);
} catch (error) {
  console.error(error.message);
}

// v2.0 -- or use safe methods for Result pattern
const result = await client.safeConvert(buffer, "doc.pdf");
if (result.success) {
  console.log(result.data.document.md_content);
}
```

#### Removed exports

- `DocumentContent` -- replaced by `ExportDocumentResponse`
- Some internal types moved to `src/types/generated/`

### New Features in v2.0

| Feature | Description |
|---------|-------------|
| Web OCR | Browser-based OCR via IBM Granite Docling model |
| Cross-runtime | Support for Node.js, Bun, Deno, Browser, CF Workers |
| Document chunking | HybridChunker and HierarchicalChunker for RAG |
| Streaming | Content, ZIP, and input streaming |
| S3 integration | Source reading and target uploading |
| VLM pipeline | Vision Language Model support |
| ASR pipeline | Audio processing (CLI) |
| OpenAPI types | Auto-generated types from Docling Serve spec |
| Zod validation | Runtime validation with Zod schemas |
| Connection pooling | HTTP connection reuse (Node.js) |
| Result pattern | `safeConvert`, `tryAsync` utilities |

### Step-by-Step Migration

1. **Update imports** -- most imports remain the same

2. **Update configuration** -- change from flat config to discriminated union:
   ```typescript
   // Before
   new Docling({ type: "api", baseUrl: "..." })
   // After
   new Docling({ api: { baseUrl: "..." } })
   ```

3. **Update binary types** -- change `Buffer` type annotations to `Uint8Array` (actual code may not need changes since `Buffer extends Uint8Array`)

4. **Update error handling** -- switch from result checking to try/catch, or use `safeConvert`:
   ```typescript
   // Before
   const r = await client.convert(buf, "doc.pdf");
   if (r.success) { ... }
   // After (option A)
   try { const r = await client.convert(buf, "doc.pdf"); ... }
   catch (e) { ... }
   // After (option B)
   const r = await client.safeConvert(buf, "doc.pdf");
   if (r.success) { ... }
   ```

5. **Update entry points** -- if using in browser, switch to `docling-sdk/browser`:
   ```typescript
   // Before
   import { Docling } from "docling-sdk";
   // After (browser)
   import { Docling } from "docling-sdk/browser";
   ```

6. **Update deprecated types** -- replace `DocumentContent` with `ExportDocumentResponse`:
   ```typescript
   // Before
   import type { DocumentContent } from "docling-sdk";
   // After
   import type { ExportDocumentResponse } from "docling-sdk";
   ```

## Related

- [Getting Started](./getting-started.md) -- installation and setup
- [Configuration](./configuration.md) -- new config format
- [TypeScript](./typescript.md) -- new type patterns
