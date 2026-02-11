# Getting Started

[Home](../README.md) > [Docs](./README.md) > Getting Started

## Prerequisites

Docling SDK supports three client modes, each with its own requirements:

| Client | Runtime | Requirement |
|--------|---------|-------------|
| API | Node.js >= 18, Bun, Deno | A running [Docling Serve](https://github.com/DS4SD/docling-serve) instance |
| CLI | Node.js >= 18 | Python with [Docling](https://github.com/DS4SD/docling) installed |
| Web | Browser with WebGPU or WASM | Peer dependencies (see below) |

## Installation

### npm (recommended)

```bash
npm install docling-sdk
```

### GitHub Package Registry

```bash
npm install @btwld/docling-sdk
```

Both packages are identical. The GitHub Package Registry version is available for enterprise environments.

### Peer dependencies

All peer dependencies are optional and only needed for specific features:

```bash
# Web OCR (browser-based OCR)
npm install @huggingface/transformers onnxruntime-web

# PDF rendering in Web client
npm install unpdf

# TypeScript (development)
npm install -D typescript
```

## Choosing Your Client

| Use case | Client | Why |
|----------|--------|-----|
| Server-side conversion through Docling Serve | API | Fastest, supports streaming, chunking, async tasks |
| Local conversion without a server | CLI | Uses Python Docling directly, batch and watch modes |
| In-browser OCR without any server | Web | Runs entirely client-side via WebGPU/WASM |

## First Conversion

### API Client

Start a [Docling Serve](https://github.com/DS4SD/docling-serve) instance, then:

```typescript
import { readFile } from "node:fs/promises";
import { Docling } from "docling-sdk";

const client = new Docling({
  api: { baseUrl: "http://localhost:5001" },
});

const buffer = await readFile("./document.pdf");
const result = await client.convert(buffer, "document.pdf", {
  to_formats: ["md"],
});

console.log(result.document.md_content);
```

See the full [API Client guide](./api-client.md) for conversion options, streaming, async tasks, and more.

### CLI Client

Install the Python Docling CLI (`pip install docling`), then:

```typescript
import { Docling } from "docling-sdk";

const client = new Docling({
  cli: { outputDir: "./output" },
});

const result = await client.convert(
  "./document.pdf",
  "document.pdf",
  { to_formats: ["md"] }
);

console.log(result.document.md_content);
```

See the full [CLI Client guide](./cli-client.md) for batch processing, directory watching, and error handling.

### Web OCR

Install the required peer dependencies first:

```bash
npm install @huggingface/transformers onnxruntime-web
```

```typescript
import { createWebClient } from "docling-sdk/web";

const client = createWebClient({ device: "webgpu" });

client.on("loading", ({ progress, status }) => {
  console.log(`Loading: ${Math.round(progress * 100)}% - ${status}`);
});

await client.initialize();

const result = await client.processImage(imageFile);
console.log(result.markdown);

client.destroy();
```

The model (~500 MB) is cached in IndexedDB after the first download.

See the full [Web Client guide](./web-client.md) for events, cache management, and standalone utilities.

## Next Steps

- [Configuration](./configuration.md) -- all available options for each client
- [API Reference](./api-reference.md) -- method-by-method reference
- [Examples](./examples.md) -- runnable example scripts
