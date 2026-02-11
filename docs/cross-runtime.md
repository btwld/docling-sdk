# Cross-Runtime

[Home](../README.md) > [Docs](./README.md) > Cross-Runtime

Docling SDK supports Node.js, Bun, Deno, browsers, and Cloudflare Workers through conditional exports and runtime detection.

## Entry Points

| Entry point | Import path | Use case |
|-------------|-------------|----------|
| Main | `docling-sdk` | Node.js, Bun, Deno (full SDK) |
| CLI | `docling-sdk/cli` | CLI-only utilities |
| Browser | `docling-sdk/browser` | Browser builds (no Node.js deps) |
| Web | `docling-sdk/web` | Web OCR client and utilities |
| Worker | `docling-sdk/web/worker` | Web Worker for OCR inference |
| Platform | `docling-sdk/platform` | Full SDK with platform utilities |

The `package.json` exports map resolves the correct build per runtime:

```json
{
  ".": {
    "browser": "./dist/browser.js",
    "bun": "./dist/index.js",
    "deno": "./dist/index.js",
    "node": "./dist/index.js"
  }
}
```

## Node.js

Full feature support including file system access, connection pooling, and WebSocket via `ws`.

```typescript
import { Docling, createAPIClient, createCLIClient } from "docling-sdk";
import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";

const client = createAPIClient("http://localhost:5001");
const buffer = await readFile("./document.pdf");

const result = await client.convert(buffer, "document.pdf", {
  to_formats: ["md"],
});

// File streaming
const zip = await client.convertToFile(buffer, "doc.pdf", {
  to_formats: ["md", "json"],
});
if (zip.success && zip.fileStream) {
  zip.fileStream.pipe(createWriteStream("./output.zip"));
}
```

Node.js features:
- File paths in `convert()` and `convertFromFile()`
- `stream.Readable` in `ConversionFileResult.fileStream`
- Connection pooling via `node:http` / `node:https` agents
- WebSocket via the `ws` package (optional dependency)
- CLI client (`DoclingCLIClient`) for local Python execution

## Bun

API client works with Bun's native `fetch` and `WebSocket`:

```typescript
import { createAPIClient } from "docling-sdk";

const client = createAPIClient("http://localhost:5001");

const file = Bun.file("./document.pdf");
const buffer = new Uint8Array(await file.arrayBuffer());

const result = await client.convert(buffer, "document.pdf", {
  to_formats: ["md"],
});

// File output
const zip = await client.convertToFile(buffer, "doc.pdf", {
  to_formats: ["md"],
});
if (zip.success && zip.data) {
  await Bun.write("./output.zip", zip.data);
}
```

Bun features:
- Native `fetch` and `WebSocket` (no `ws` needed)
- `Bun.file()` for reading input files
- `Bun.write()` for writing output
- `ConversionFileResult.data` returns `Uint8Array`

## Deno

Use `npm:` imports with appropriate permissions:

```typescript
import { createAPIClient } from "npm:docling-sdk";

const client = createAPIClient("http://localhost:5001");

const buffer = await Deno.readFile("./document.pdf");

const result = await client.convert(buffer, "document.pdf", {
  to_formats: ["md"],
});

// File output
const zip = await client.convertToFile(buffer, "doc.pdf", {
  to_formats: ["md"],
});
if (zip.success && zip.data) {
  await Deno.writeFile("./output.zip", zip.data);
}
```

Required permissions:
- `--allow-net` for API calls
- `--allow-env` for environment variable access (S3 credentials)
- `--allow-read` for file input

```bash
deno run --allow-net --allow-env --allow-read script.ts
```

## Browser

Use the `docling-sdk/browser` entry point for a build without Node.js dependencies:

```typescript
import { Docling, createAPIClient } from "docling-sdk/browser";

const client = createAPIClient("http://localhost:5001");

// From File input
const file = document.querySelector("input[type=file]").files[0];
const buffer = new Uint8Array(await file.arrayBuffer());

const result = await client.convert(buffer, file.name, {
  to_formats: ["md"],
});
```

### Web OCR (no server)

```typescript
import { createWebClient } from "docling-sdk/web";

const client = createWebClient({ device: "webgpu" });
await client.initialize();

const result = await client.processImage(file);
console.log(result.markdown);
```

### Bundler setup

For Vite, webpack, or other bundlers, the `browser` condition in `package.json` exports automatically resolves the correct build:

```typescript
// In a bundler context, this resolves to the browser build
import { Docling } from "docling-sdk";
```

For the Web OCR worker, configure your bundler to handle the worker import:

```typescript
// Vite example
import workerUrl from "docling-sdk/web/worker?worker&url";
const client = createWebClient({ workerUrl });
```

## Cloudflare Workers

Use the worker-compatible APIs (no file system, no Node.js streams):

```typescript
import { createAPIClient } from "docling-sdk";

export default {
  async fetch(request: Request): Promise<Response> {
    const client = createAPIClient("https://docling.example.com");

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const buffer = new Uint8Array(await file.arrayBuffer());

    const result = await client.convert(buffer, file.name, {
      to_formats: ["md"],
    });

    return new Response(result.document.md_content, {
      headers: { "Content-Type": "text/markdown" },
    });
  },
};
```

Cloudflare Workers limitations:
- No file system access
- No Node.js streams (`fileStream` will be `undefined`; use `data` instead)
- No CLI client
- No WebSocket (use HTTP polling for progress)

## Platform Detection

The SDK provides runtime detection utilities:

```typescript
import {
  isNode,
  isBun,
  isDeno,
  isBrowser,
  isServer,
  detectRuntime,
  getRuntimeInfo,
} from "docling-sdk/platform";

console.log(detectRuntime());
// "node" | "bun" | "deno" | "browser" | "unknown"

console.log(getRuntimeInfo());
// {
//   runtime: "node",
//   version: "20.11.0",
//   features: {
//     nativeWebSocket: true,
//     nativeFetch: true,
//     webStreams: true,
//     ...
//   }
// }
```

### Feature detection

```typescript
import {
  hasNativeWebSocket,
  hasNativeFetch,
  hasWebStreams,
  hasAbortController,
  hasFormData,
  hasBlob,
  hasFile,
  hasRandomUUID,
} from "docling-sdk/platform";
```

## Related

- [Getting Started](./getting-started.md) -- prerequisites per runtime
- [Streaming](./streaming.md) -- cross-runtime streaming patterns
- [Web Client](./web-client.md) -- browser-based OCR
- [Examples](./examples.md) -- runtime-specific examples
