# Error Handling

[Home](../README.md) > [Docs](./README.md) > Error Handling

The optional native backend exports `NativeError` from `docling-sdk/native`, with a distinct [result/error contract](native-client.md#results-and-errors). Check `partial_success` and page coverage before treating a capture as complete.

## Conversion errors

Ordinary `convert` methods return a `ConvertDocumentResponse` and reject on
operation errors. Check the response's `status` and `errors` for conversion
outcomes, including partial success. File-output methods use a separate
`ConversionFileResult`; see the [Result pattern](#result-pattern) below.

The SDK's error classes are exported from the main entry:

| Class | Meaning | Additional fields |
|---|---|---|
| `DoclingError` | Base SDK error | `code`, `details` |
| `DoclingNetworkError` | HTTP/connection failure | `statusCode`, `response` |
| `DoclingValidationError` | Invalid input or options | `field`, `value` |
| `DoclingTimeoutError` | Operation exceeded its timeout | Error message |
| `DoclingFileError` | File read/write failure | `filePath`, `fileSize` |

```typescript
import { DoclingNetworkError } from "docling-sdk";

try {
  const result = await client.convert(buffer, "doc.pdf");
  console.log(result.document.md_content);
} catch (error) {
  if (error instanceof DoclingNetworkError) {
    console.error(error.statusCode, error.message);
  } else {
    throw error;
  }
}
```

Errors can also be ordinary JavaScript errors; do not assume every failure is a
specific SDK subclass.

## CLI errors and retries

`CliUtils` defines `CliError` (with `exitCode`, `stdout`, `stderr`),
`CliTimeoutError`, and `CliNotFoundError`. Ordinary main-client conversion reports
failed/partial formats in its status and errors; invalid input or initialization
can reject. For content/progress/stream conversion, parent SIGINT/SIGTERM rejects
as `ProcessAbortError` after job cleanup and prevents later formats/sources from
starting. Batch/directory conversion also propagates cancellation after active
chunk cleanup; ordinary per-file failures still allow batch continuation.
`convertMultipleFiles()` retains eager dispatch and per-file failure results.
If its progress callback throws, it waits for started siblings to settle before
rejecting. `convertToStream()` observes destination errors from the start, stops
conversion on early destination failure/finish, and waits for writable
finalization before resolving. Rejected stream operations destroy the destination
and clean the job.

ZIP file-output methods retain their failure-result contract, with the execution
error in its details. Signal termination is never a zero exit status. Conversion
does not automatically retry based on diagnostic text; see
[CLI execution and retry behavior](cli-client.md#error-classification-and-retry).

Python's `document_timeout` flag is not the SDK process timeout. The pinned
Python runtime did not enforce that internal timer in a real multi-page probe;
use the SDK `timeout` for process termination and cleanup. See the CLI guide for
the validated runtime and page-range limitation.

## API retries

The platform HTTP client passes retry settings to `ofetch`: by default three
retries, a fixed numeric delay of 1000 ms, and status codes 408, 429, 500, 502,
503 and 504. Explicit `retries: 0` disables those retries through construction,
configuration updates and request overrides, including streamed responses.
Transport updates preserve configured API-key and custom headers. API-key-only
updates take effect too; custom headers retain precedence. Individual transfer
paths can configure requests differently; do not assume every method retries
identically. See `src/platform/http.ts` for the implementation.

## Validation

Use `ValidationUtils` for SDK validation helpers or `ZodValidation` for schema
validation with field-level issues:

```typescript
import { ZodValidation } from "docling-sdk";

const result = ZodValidation.safeValidateConversionOptions({
  to_formats: ["md"],
  do_ocr: true,
});
if (!result.success) console.error(result.error.issues);
```

See the [TypeScript guide](typescript.md#zod-validation) for more helpers.

## Result pattern

`Result<T, E>` is either `{ success: true, data: T }` or
`{ success: false, error: E }`. `safeConvert` wraps rejected conversions in this
shape on all three clients:

```typescript
const result = await client.safeConvert(buffer, "doc.pdf");
if (result.success) {
  console.log(result.data.document.md_content);
} else {
  console.error(result.error.message);
}
```

The file-output contract differs:

| Method | API / CLI | Web |
|---|---|---|
| `convertToFile` | Returns `ConversionFileResult`; inspect its `success` and payload | Rejects as unsupported |
| `safeConvertToFile` | Wraps `ConversionFileResult` in an outer Result | Rejects as unsupported, despite its name |

For API/CLI `safeConvertToFile`, an outer success means the call resolved; the
inner `data.success` still determines whether file conversion succeeded:

```typescript
const wrapped = await client.safeConvertToFile(buffer, "doc.pdf", {
  to_formats: ["md"],
});
if (!wrapped.success) {
  console.error(wrapped.error.message);
} else if (!wrapped.data.success) {
  console.error(wrapped.data.error?.message);
} else {
  // Inspect wrapped.data.fileStream or wrapped.data.data for this method/runtime.
}
```

`tryAsync(() => operation())` provides the same outer wrapping for other async
functions. It catches rejection; it does not reinterpret a resolved failure
object as a rejected operation.

## Related

- [Streaming and File Output](streaming.md) — payload availability and buffering
- [API Client](api-client.md) — API operations
- [CLI Client](cli-client.md) — local execution and retry behavior
- [Web Client](web-client.md) — browser OCR capabilities
