# Docling SDK

TypeScript clients for [Docling](https://github.com/DS4SD/docling).

- Convert documents to Markdown, HTML, text and structured JSON.
- **API:** Docling Serve performs conversion, chunking and S3 work; the SDK sends requests and tracks tasks.
- **CLI:** Node runs an installed Python Docling command for local conversion and batch work.
- **Web OCR:** a browser worker runs a downloaded model on images; PDF pages first render to images with optional `unpdf`.
- Clients share conversion methods but have different capabilities; choose by where processing should run. Web does not parse Office/HTML inputs or support file-output methods.
- Portable binary input is `Uint8Array`; filesystem and stream behavior depend on the method and runtime.
- Ordinary conversion returns a document response; `safeConvert` wraps rejection. File-output methods have a separate success/failure contract.
- The package publishes ESM. Browser API use starts with `createAPIClient` from `docling-sdk/browser`; local OCR starts with `createWebClient` from `docling-sdk/web`.

## Install

```bash
npm install docling-sdk
```

API mode needs a running [Docling Serve](https://github.com/DS4SD/docling-serve)
instance. CLI mode needs Python Docling installed locally and Node.js >=18.
Node API usage also requires Node.js >=18.

For browser OCR, install its optional peers:

```bash
npm install @huggingface/transformers onnxruntime-web
# Also needed for Web PDF rendering:
npm install unpdf
```

## First API conversion (Node)

```typescript
import { readFile } from "node:fs/promises";
import { createAPIClient } from "docling-sdk";

const client = createAPIClient("http://localhost:5001");
const result = await client.convert(await readFile("input.pdf"), "input.pdf", {
  to_formats: ["md"],
});
console.log(result.document.md_content);
```

## Next steps

- [Getting started](docs/getting-started.md) — setup and examples for all three modes
- [Guides and reference](docs/README.md) — configuration, features and client methods
- [Runtime entry points](docs/cross-runtime.md) — browser imports and worker setup
- [Transfer behavior](docs/streaming.md) — buffering, streams and byte output
- [Architecture decisions](ARCHITECTURE.md) — rationale and superseded choices
- [Examples](docs/examples.md) · [Contributing](CONTRIBUTING.md)

[BSD-3-Clause license](LICENSE).
