# TypeScript

[Home](../README.md) > [Docs](./README.md) > TypeScript

The SDK uses TypeScript strict mode. Its public API types are maintained in
`src/types/api.ts`, with client interfaces in `src/types/client.ts`.

## Factories and client types

The Node entry infers a concrete client from the configuration:

```typescript
import { Docling, createAPIClient } from "docling-sdk";
import type { ConversionOptions, ConvertDocumentResponse } from "docling-sdk";

const api = createAPIClient("http://localhost:5001");
const cli = new Docling({ cli: { outputDir: "./output" } });
const options: ConversionOptions = { to_formats: ["md"] };
```

The exported interfaces `DoclingClientBase`, `DoclingAPI`, `DoclingCLI` and
`DoclingWeb` describe shared and client-specific methods. Sharing an interface
does not imply feature parity: the Web client's file-output methods reject as
unsupported. Check the [API reference](api-reference.md) for each concrete client.

`isAPIClient`, `isCLIClient` and `isWebClient` narrow client instances returned by
the main factory. Configuration guards defined inside `src/types/client.ts` are
not exported as functions from the package root.

## Result pattern

`safeConvert` returns `Result<ConvertDocumentResponse, ProcessingError>`.
File-output methods use a different contract, including nested results for
`safeConvertToFile` on API/CLI and unsupported operations on Web. See the
[canonical error-handling guide](error-handling.md#result-pattern) for examples
and the distinction between rejection and a resolved failure object.

The main entry also exports `tryAsync`, `success`, `failure` and the Result types
for callers implementing their own wrappers.

## OpenAPI types and adapters

The type-only `OpenAPI` namespace is exported, but
`src/types/generated/api.ts` currently contains placeholder `paths`, `components`
and `operations`, not generated endpoint definitions. Endpoint-indexing examples
will not work until that scaffold is populated. Handwritten types remain the
SDK's primary contract.

To generate types against a running Docling Serve instance:

```bash
npm run openapi:fetch
npm run openapi:generate
```

`DOCLING_URL` or `openapi:fetch -- --url URL` selects a different server. Confirm
that fetching created `openapi/docling-serve.json` before generating: the fetcher
also accepts YAML, while the generation script reads only the JSON path. Do not
hand-edit generated output. Keep handwritten types, runtime schemas and adapters
consistent when changing the SDK contract.

S3 adapters translate the SDK's convenience fields into server request fields;
see [S3 Integration](s3-integration.md). The
[architecture log](../ARCHITECTURE.md#sdk-contract-and-server-adapters) records
this boundary and its synchronization cost.

## Zod validation

```typescript
import { ZodValidation } from "docling-sdk";

const options = ZodValidation.validateConversionOptions({
  to_formats: ["md"],
  do_ocr: true,
});

const result = ZodValidation.safeValidateConversionOptions(userInput);
if (!result.success) console.error(result.error.issues);

ZodValidation.isValidInputFormat("pdf");
ZodValidation.isValidOutputFormat("md");
ZodValidation.isValidOcrEngine("easyocr");
```

Runtime validation and compile-time types are separate surfaces; both need to
match the server contract.

## Entry points

Use the [runtime entry-point table](cross-runtime.md#entry-points) to select a
build. The browser entry excludes the main `Docling` and CLI factories.

```typescript
import { createAPIClient } from "docling-sdk/browser";
import { createWebClient, doclingToMarkdown } from "docling-sdk/web";
```

See [Cross-Runtime](cross-runtime.md) for entry selection and worker bundling.
