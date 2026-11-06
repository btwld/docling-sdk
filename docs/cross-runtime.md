# Cross-Runtime

[Home](../README.md) > [Docs](./README.md) > Cross-Runtime

The API transport uses fetch-based platform adapters and `Uint8Array` inputs.
CLI execution requires Node and Python; local OCR requires browser worker APIs.
Client capabilities and transfer behavior vary by runtime.

## Entry points

| Import path | Purpose |
|---|---|
| `docling-sdk` | Node/Bun/Deno main build; browser-aware bundlers select the browser build |
| `docling-sdk/cli` | Node CLI client and helpers |
| `docling-sdk/browser` | API and Web client factories, excluding the Node CLI; no `Docling` factory |
| `docling-sdk/web` | Browser OCR and standalone DocTags/cache/PDF utilities |
| `docling-sdk/web/worker` | Worker inference script, with initialization side effects |
| `docling-sdk/platform` | Alias of the main build; not a standalone export of internal platform utilities |

The root `browser` condition selects `dist/browser.js`. Use the explicit browser
entry when the consumer must exclude CLI code; check your bundler's resolved
exports rather than assuming every root export exists in every environment.

## Node.js

```typescript
import { readFile } from "node:fs/promises";
import { createAPIClient } from "docling-sdk";

const client = createAPIClient("http://localhost:5001");
const result = await client.convert(await readFile("document.pdf"), "document.pdf", {
  to_formats: ["md"],
});
console.log(result.document.md_content);
```

Node supports file paths and Node streams on the methods that expose them, and
uses optional `ws` for WebSocket progress. HTTP uses the platform fetch client.
The unused, unexported `ConnectionPool` implementation has been removed.
ZIP output loads optional `fflate` only when requested; HTTP/browser consumers
can install with `--omit=optional` without loading a ZIP implementation.

## Bun and Deno

Use `Uint8Array` input with the API client. Read a Bun file with
`new Uint8Array(await Bun.file("document.pdf").arrayBuffer())`, or use
`await Deno.readFile("document.pdf")` in Deno.

```typescript
// Deno
import { createAPIClient } from "npm:docling-sdk";

const client = createAPIClient("http://localhost:5001");
const input = await Deno.readFile("document.pdf");
const result = await client.convert(input, "document.pdf", { to_formats: ["md"] });
console.log(result.document.md_content);
```

Deno requires permissions for the capabilities used by the consumer. The main
entry includes Node-compatible CLI code, but no longer eagerly imports the ZIP
library. Environment-based S3 credentials need env access; saving output needs
write access. Bun/Deno examples are not a substitute for a runtime compatibility
pass on the versions your application uses.

For API `convertToFile`, check `success`, then inspect whether `fileStream` or
`data` is present. Runtime detection distinguishes Deno/Bun from Node, so those
runtimes use the `data` byte fallback rather than incidental Node-compatible
streams. Browser ZIP
downloads return `data` bytes, including async file downloads; see
[transfer behavior](streaming.md#method-behavior).

## Browser API conversion

The browser build exports `createAPIClient`, not `Docling`:

```typescript
import { createAPIClient } from "docling-sdk/browser";

const client = createAPIClient("http://localhost:5001");
const input = document.querySelector<HTMLInputElement>('input[type="file"]');
const file = input?.files?.[0];
if (!file) throw new Error("Choose a document first");

const result = await client.convert(
  new Uint8Array(await file.arrayBuffer()),
  file.name,
  { to_formats: ["md"] }
);
console.log(result.document.md_content);
```

Docling Serve must be reachable from the browser with appropriate CORS settings.
When a bundler selects the root browser condition, use the same browser factory.

## Browser-local OCR and worker bundling

Use `createWebClient` from `docling-sdk/web`; see the [Web guide](web-client.md)
for peer dependencies, initialization, model download and cleanup. Web OCR
accepts images and rendered PDF pages, not the API client's full Office/HTML
input-format set.

Provide a bundler-resolved worker URL. The legacy default blob loader contains
a bare package import, which ordinary browsers cannot resolve without a matching
module-resolution setup. For example, in Vite:

```typescript
import { createWebClient } from "docling-sdk/web";
import workerUrl from "docling-sdk/web/worker?worker&url";

const client = createWebClient({ workerUrl });
await client.initialize();
// Process images, then call client.destroy().
```

Preserve the worker bundle's initialization side effects. Importing the worker
script in the UI entry does not create a worker. See
[worker packaging rationale](../ARCHITECTURE.md#browser-inference-worker).

## Cloudflare Workers and other edge runtimes

Bundle the API client through the browser entry and verify the deployment's
export resolution and fetch support. Filesystem access, the local CLI and Node
stream methods require capabilities that ordinary edge runtimes do not provide.
Use HTTP progress polling when the runtime cannot provide the required outgoing
WebSocket implementation.

CI runs unit/coverage/build checks on Node 20, 22 and 24, and packed consumers on
Linux, macOS and Windows with Node 18 and 24. The consumer check includes browser
bundling, not real model inference or a Bun/Deno/edge matrix.
The [runtime examples](examples.md#runtime-examples) provide starting points for
checking the paths your application uses.

## Related

- [Streaming and File Output](streaming.md) — buffering and payload differences
- [Getting Started](getting-started.md) — prerequisites
- [Architecture decisions](../ARCHITECTURE.md#runtime-boundaries) — runtime isolation
