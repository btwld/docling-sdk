# TypeScript

[Home](../README.md) > [Docs](./README.md) > TypeScript

Native types (`NativeClient`, `NativeConversionResult`, `NativeRuntimeManifest`) are exported only from `docling-sdk/native`. They do not extend the broad shared client type; upstream JSON remains runtime-validated data, not a TypeScript completeness guarantee. See the [native contract](native-client.md).

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

The type-only `OpenAPI` namespace contains real endpoint definitions generated
from the pinned **Docling Serve 1.7.2** schema. Handwritten types remain the SDK's
primary contract; raw server types do not imply every endpoint or option is
implemented by every client.

```typescript
import type { OpenAPI } from "docling-sdk";

type ConvertEndpoint = OpenAPI.paths["/v1/convert/source"]["post"];
type TaskStatus = OpenAPI.components["schemas"]["TaskStatusResponse"];
```

Regenerate and verify from the checked-in schema without a running server:

```bash
npm run openapi:generate
npm run openapi:check
```

`DOCLING_URL` or `openapi:fetch -- --url URL` selects a server for a candidate
update. Fetching accepts only OpenAPI JSON with the pinned Serve version;
generation verifies its reviewed digest. See the [schema provenance and update
procedure](../openapi/README.md). Do not hand-edit generated output. Keep
handwritten types, runtime schemas and adapters consistent when changing the SDK
contract. Runtime validators accept the declared camel-case CLI options as well
as previously accepted legacy snake-case fields.

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
