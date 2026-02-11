# Error Handling

[Home](../README.md) > [Docs](./README.md) > Error Handling

## Error Hierarchy

The SDK defines a hierarchy of error classes in `src/types/index.ts`:

```
DoclingError (base)
  DoclingNetworkError     -- HTTP/connection failures
  DoclingValidationError  -- Invalid options or input
  DoclingTimeoutError     -- Operation timeout
  DoclingFileError        -- File read/write failures
```

### DoclingError

Base error class with optional `code` and `details`:

```typescript
try {
  await client.convert(buffer, "doc.pdf");
} catch (error) {
  if (error instanceof DoclingError) {
    console.log(error.message);
    console.log(error.code);     // e.g., "NETWORK_ERROR"
    console.log(error.details);  // additional context
  }
}
```

### DoclingNetworkError

Thrown for HTTP failures. Includes `statusCode` and raw `response`:

```typescript
try {
  await client.convert(buffer, "doc.pdf");
} catch (error) {
  if (error instanceof DoclingNetworkError) {
    console.log(error.statusCode);  // e.g., 502
    console.log(error.response);    // raw response body
  }
}
```

### DoclingValidationError

Thrown when conversion options or input are invalid. Includes the `field` name and offending `value`:

```typescript
try {
  await client.convert(buffer, "doc.pdf", { table_mode: "invalid" as any });
} catch (error) {
  if (error instanceof DoclingValidationError) {
    console.log(error.field);  // "conversion_options"
    console.log(error.value);  // the invalid options object
  }
}
```

### DoclingTimeoutError

Thrown when an operation exceeds its timeout:

```typescript
try {
  await client.convert(buffer, "large.pdf");
} catch (error) {
  if (error instanceof DoclingTimeoutError) {
    console.log(error.message);
    // "Operation convert timed out after 60000ms"
  }
}
```

### DoclingFileError

Thrown for file system operations. Includes `filePath` and `fileSize`:

```typescript
try {
  await client.convertFromFile("./missing.pdf");
} catch (error) {
  if (error instanceof DoclingFileError) {
    console.log(error.filePath);
  }
}
```

## CLI Error Classes

The CLI client defines its own error types in `src/types/cli.ts`:

### CliError

Thrown when the Docling CLI process exits with an error:

```typescript
try {
  await cliClient.convert("./doc.pdf", "doc.pdf");
} catch (error) {
  if (error instanceof CliError) {
    console.log(error.exitCode);
    console.log(error.stdout);
    console.log(error.stderr);
  }
}
```

### CliTimeoutError

Thrown when the CLI process exceeds the configured timeout:

```typescript
try {
  await cliClient.convert("./large.pdf", "large.pdf");
} catch (error) {
  if (error instanceof CliTimeoutError) {
    console.log(error.message);
    // "CLI command timed out after 60000ms"
  }
}
```

### CliNotFoundError

Thrown when the Docling CLI binary cannot be found:

```typescript
try {
  const client = new Docling({ cli: {} });
  await client.convert("./doc.pdf", "doc.pdf");
} catch (error) {
  if (error instanceof CliNotFoundError) {
    console.log(error.message);
    // "Docling CLI not found"
  }
}
```

## Error Classification (CLI)

The CLI client classifies errors into five types for retry logic:

| Type | Retryable | Examples |
|------|-----------|----------|
| `transient` | Yes | Temporary failures, intermittent issues |
| `timeout` | Yes | Process timeouts |
| `resource` | Yes | Memory or disk pressure |
| `permanent` | No | Invalid input, missing files |
| `configuration` | No | Wrong CLI path, missing Python |

The `retryConfig` in the CLI client controls retry behavior:

```typescript
// Default retry configuration
{
  maxRetries: 3,
  baseDelay: 1000,        // ms
  maxDelay: 30000,         // ms
  backoffMultiplier: 2,
  retryableErrors: ["transient", "timeout", "resource"],
}
```

## API Retry Logic

The HTTP client retries on specific status codes with exponential backoff:

- **408** -- Request Timeout
- **429** -- Too Many Requests
- **500** -- Internal Server Error
- **502** -- Bad Gateway
- **503** -- Service Unavailable
- **504** -- Gateway Timeout

Default retry settings:

| Setting | Default |
|---------|---------|
| Retries | 3 |
| Retry delay | 1000 ms |
| Backoff | Exponential |

## Validation

### ValidationUtils

Static methods for validating inputs before making API calls:

```typescript
import { ValidationUtils } from "docling-sdk";

ValidationUtils.validateInputFormat("pdf");       // true
ValidationUtils.validateOutputFormat("md");        // true
ValidationUtils.validateOcrEngine("easyocr");      // true
ValidationUtils.validatePdfBackend("dlparse_v2");  // true
ValidationUtils.validateTableMode("accurate");     // true
ValidationUtils.validatePageRange([1, 10]);        // true
ValidationUtils.validateUrl("https://example.com"); // true
```

### Asserting valid options

Throws `DoclingValidationError` if options are invalid:

```typescript
import { ValidationUtils } from "docling-sdk";

ValidationUtils.assertValidConversionOptions({
  to_formats: ["md"],
  table_mode: "accurate",
});
// Passes silently

ValidationUtils.assertValidConversionOptions({
  to_formats: ["invalid" as any],
});
// Throws DoclingValidationError
```

### Zod validation

Runtime validation with detailed error messages:

```typescript
import { ZodValidation } from "docling-sdk";

const result = ZodValidation.safeValidateConversionOptions({
  to_formats: ["md"],
  do_ocr: true,
});

if (result.success) {
  console.log(result.data); // validated options
} else {
  console.log(result.error); // Zod error with field-level details
}
```

## Safe Methods (Result Pattern)

Every client exposes `safeConvert` and `safeConvertToFile`, which return `Result<T, E>` instead of throwing:

```typescript
const result = await client.safeConvert(buffer, "doc.pdf");

if (result.success) {
  console.log(result.data.document.md_content);
} else {
  console.error(result.error.message);
}
```

You can also wrap any async operation with `tryAsync`:

```typescript
import { tryAsync } from "docling-sdk";

const result = await tryAsync(() =>
  client.convert(buffer, "doc.pdf")
);

if (result.success) {
  // result.data is ConvertDocumentResponse
} else {
  // result.error is the caught Error
}
```

See the [TypeScript guide](./typescript.md) for more on the Result pattern.

## Related

- [TypeScript](./typescript.md) -- Result types and type guards
- [API Client](./api-client.md) -- safe methods on the API client
- [CLI Client](./cli-client.md) -- CLI error handling
