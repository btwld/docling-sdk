# VLM Pipeline

[Home](../README.md) > [Docs](./README.md) > VLM Pipeline

The SDK supports Vision Language Model (VLM) and Automatic Speech Recognition (ASR) pipelines through Docling Serve.

## VLM Overview

Set `pipeline: "vlm"` in conversion options to use a VLM for document understanding instead of the standard layout analysis pipeline:

```typescript
const result = await client.convert(buffer, "document.pdf", {
  pipeline: "vlm",
  vlm_pipeline_model: "smoldocling",
});
```

## Preset Models

Use `vlm_pipeline_model` for built-in model presets:

```typescript
const result = await client.convert(buffer, "document.pdf", {
  pipeline: "vlm",
  vlm_pipeline_model: "smoldocling",
  do_picture_description: true,
  do_picture_classification: true,
});
```

The CLI client supports additional preset models:

| Model | Client | Description |
|-------|--------|-------------|
| `smoldocling` | API, CLI | SmolDocling model |
| `granite_vision` | CLI only | IBM Granite Vision model |
| `smolvlm` | CLI only | SmolVLM model |

## Local Models

Configure a custom local VLM with `vlm_pipeline_model_local`:

```typescript
const result = await client.convert(buffer, "document.pdf", {
  pipeline: "vlm",
  vlm_pipeline_model_local: {
    repo_id: "microsoft/DialoGPT-medium",
    prompt: "Describe this image in detail:",
    scale: 1.0,
    response_format: "markdown",         // "markdown" | "doctags"
    inference_framework: "transformers",  // "transformers" | "mlx"
    transformers_model_type: "automodel-vision2seq",  // "automodel-vision2seq" | "automodel"
    extra_generation_config: {
      max_length: 512,
    },
  },
});
```

### VlmModelLocal fields

| Field | Type | Description |
|-------|------|-------------|
| `repo_id` | `string` | HuggingFace model repository ID |
| `prompt` | `string` | Prompt sent to the model |
| `scale` | `number` | Image scaling factor |
| `response_format` | `"doctags" \| "markdown"` | Expected output format |
| `inference_framework` | `"transformers" \| "mlx"` | Inference backend |
| `transformers_model_type` | `"automodel-vision2seq" \| "automodel"` | Model type for transformers |
| `extra_generation_config` | `Record<string, unknown>` | Additional generation parameters |

## API Models

Use a remote VLM API endpoint with `vlm_pipeline_model_api`:

```typescript
const result = await client.convert(buffer, "document.pdf", {
  pipeline: "vlm",
  vlm_pipeline_model_api: {
    url: "https://api.example.com/v1/chat/completions",
    headers: {
      "Authorization": "Bearer sk-...",
    },
    params: {
      model: "gpt-4-vision-preview",
    },
    timeout: 30000,
    concurrency: 2,
    prompt: "Describe the content of this document page:",
    scale: 1.0,
    response_format: "markdown",
  },
});
```

### VlmModelApi fields

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | API endpoint URL |
| `headers` | `Record<string, string>` | HTTP headers (e.g., auth) |
| `params` | `Record<string, unknown>` | Additional API parameters |
| `timeout` | `number` | Request timeout in ms |
| `concurrency` | `number` | Max concurrent API calls |
| `prompt` | `string` | Prompt sent with each page |
| `scale` | `number` | Image scaling factor |
| `response_format` | `"doctags" \| "markdown"` | Expected output format |

## Picture Description

Independent of the pipeline setting, you can enable picture description to generate text descriptions for images found in documents:

```typescript
const result = await client.convert(buffer, "document.pdf", {
  do_picture_description: true,
  picture_description_area_threshold: 0.05,  // minimum area ratio (0-1)

  // Option 1: Local model
  picture_description_local: {
    repo_id: "Salesforce/blip2-opt-2.7b",
    generation_config: { max_new_tokens: 200 },
    prompt: "Describe this image:",
  },

  // Option 2: API model (mutually exclusive with local)
  // picture_description_api: {
  //   url: "https://api.example.com/describe",
  //   timeout: 10000,
  //   concurrency: 4,
  //   prompt: "Describe this image:",
  // },
});
```

`picture_description_local` and `picture_description_api` are mutually exclusive.

## ASR Pipeline

Use `pipeline: "asr"` for audio document processing with Whisper models:

```typescript
// CLI client only
const result = await cliClient.convert("./recording.mp3", "recording.mp3", {
  pipeline: "asr",
});
```

Available ASR models (CLI only):

| Model | Description |
|-------|-------------|
| `whisper_tiny` | Smallest, fastest |
| `whisper_base` | Small, fast |
| `whisper_small` | Medium accuracy |
| `whisper_medium` | Good accuracy |
| `whisper_large` | Best accuracy |
| `whisper_turbo` | Optimized for speed |

Configure via `CliConvertOptions.asrModel`:

```typescript
// Using CLI convert options directly
await cliClient.convert("./audio.mp3", "audio.mp3", {
  pipeline: "asr",
});
```

## Related

- [API Client](./api-client.md) -- conversion methods
- [CLI Client](./cli-client.md) -- CLI-specific VLM and ASR options
- [Configuration](./configuration.md) -- ConversionOptions reference
