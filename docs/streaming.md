# Streaming and File Output

[Home](../README.md) > [Docs](./README.md) > Streaming

A stream input or output does not guarantee bounded memory use. The API client
has several transfer paths with different buffering and runtime requirements.

## Method behavior

| API client method | Input / output | Current behavior |
|---|---|---|
| `convertToStream` (default content mode) | Bytes → writable | Receives the JSON conversion response before writing content; the result can be buffered |
| `convertToFile` | Bytes → ZIP result | Buffers the ZIP; returns `fileStream` (a Node readable) when the SDK's internal `isNode()` is true, otherwise `data: Uint8Array` |
| `convertStream` | Node readable → document | Accepts a Node input stream; the multipart encoder collects input chunks before upload |
| `convertStreamToFile` | Node readable → ZIP result | Buffers multipart input, submits asynchronously and returns a Node download stream after completion; no portable byte fallback |
| `getTaskResultFile` | Task ID → ZIP result | Uses the Node download-stream path; no portable byte fallback |

For API `convertToFile`, check `success`, then inspect the returned payload field.
The runtime checks can overlap: on Deno 2.9.6, both `isNode()` and `isDeno()` return
true, so this method returns `fileStream`, without `data`. The byte fallback is
selected by `!isNode()`, not by the runtime's name. Async file-output methods do
not offer this fallback. Web OCR does not support `convertToFile` or
`safeConvertToFile`.

## Write converted content (Node)

```typescript
import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createAPIClient } from "docling-sdk";

const client = createAPIClient("http://localhost:5001");
const result = await client.convertToStream(
  await readFile("document.pdf"),
  "document.pdf",
  createWriteStream("output.md"),
  { to_formats: ["md"] }
);
if (!result.success) throw new Error(result.error?.message);
```

This writes to a writable destination after conversion; it is not a promise of
incremental conversion or constant memory use.

## ZIP download after async conversion (Node)

```typescript
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const result = await client.convertStreamToFile(
  createReadStream("document.pdf"),
  "document.pdf",
  { to_formats: ["md", "json"] }
);
if (!result.success || !result.fileStream) {
  throw new Error(result.error?.message ?? "No ZIP stream returned");
}
await pipeline(result.fileStream, createWriteStream("result.zip"));
```

The download can stream, but the input is collected for multipart upload first.

## ConversionFileResult

`success` reports operation success. Depending on the method and runtime, a
successful result has `fileStream` (a Node readable) or `data` (bytes), plus
`fileMetadata` with filename, content type and optional size. On failure inspect
`error`. Always check the payload field expected from the selected method.

When `data` is present, save those bytes using `Bun.write`, `Deno.writeFile`, or a
browser `Blob` download as appropriate. When `fileStream` is present (including
on Deno 2.9.6), use a compatible Node stream destination or collect its byte chunks
before passing bytes to a runtime file API. Deno file output requires
`--allow-write` in addition to permissions needed for conversion.

## Related

- [API Client](api-client.md) — conversion methods
- [Async and Progress](async-progress.md) — tasks and result retrieval
- [Cross-Runtime](cross-runtime.md) — runtime entry points
- [Error Handling](error-handling.md#result-pattern) — file result versus safe wrapper
