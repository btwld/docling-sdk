/**
 * Web Worker for Docling model loading and inference
 *
 * Ported from web-ocr/packages/docling-client/src/worker.ts
 */

import {
  AutoModelForVision2Seq,
  AutoProcessor,
  TextStreamer,
  env,
  load_image,
} from "@huggingface/transformers";

import type {
  DoclingWebConfig,
  WorkerMessageFromWorker,
  WorkerMessageToWorker,
} from "../types/web";
import { createCustomCache } from "./cache";
import { doclingToHtml } from "./converters/html-converter";
import { doclingToJson } from "./converters/json-converter";
import { doclingToMarkdown } from "./converters/markdown-converter";
import { doclingToPlainText } from "./converters/text-converter";
import { extractOverlays } from "./extractors/overlay-extractor";
import { extractTables } from "./extractors/table-extractor";

// Worker global scope type (avoids needing WebWorker lib in tsconfig)
declare const self: {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

// Configure transformers.js environment
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.allowRemoteModels = true;
env.allowLocalModels = false;

const DEFAULT_MODEL_ID = "onnx-community/granite-docling-258M-ONNX";

// biome-ignore lint/suspicious/noExplicitAny: transformers.js types are complex and unstable
let processor: any = null;
// biome-ignore lint/suspicious/noExplicitAny: transformers.js types are complex and unstable
let model: any = null;
let isInitialized = false;

function postTypedMessage(message: WorkerMessageFromWorker): void {
  self.postMessage(message);
}

function setupCache(): void {
  env.customCache = createCustomCache((progress, status) => {
    postTypedMessage({
      type: "PROGRESS",
      progress,
      status,
    });
  });
}

async function loadModel(config: DoclingWebConfig): Promise<void> {
  const modelId = config.modelId ?? DEFAULT_MODEL_ID;

  if (config.wasmPaths) {
    (env.backends as { onnx?: { wasm?: { wasmPaths?: Record<string, string> } } }).onnx = {
      wasm: {
        wasmPaths: config.wasmPaths,
      },
    };
  }

  if (!processor) {
    postTypedMessage({ type: "PROGRESS", progress: 0, status: "Loading processor..." });
    processor = await AutoProcessor.from_pretrained(modelId);
  }

  if (!model) {
    postTypedMessage({ type: "PROGRESS", progress: 0.1, status: "Loading model..." });

    let device: "webgpu" | "wasm" = "webgpu";
    if (config.device === "wasm") {
      device = "wasm";
    } else if (config.device === "auto" || config.device === "webgpu") {
      const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
      if (!gpu) {
        console.warn("WebGPU not available, falling back to WASM");
        device = "wasm";
      }
    }

    const progress: Record<string, { loaded: number; total: number }> = {};

    model = await AutoModelForVision2Seq.from_pretrained(modelId, {
      dtype: {
        embed_tokens: "fp16",
        vision_encoder: "fp32",
        decoder_model_merged: "fp32",
      },
      device,
      // biome-ignore lint/suspicious/noExplicitAny: progress callback type from transformers.js
      progress_callback: (data: any) => {
        if (data.status === "progress" && data.file?.endsWith?.("onnx_data")) {
          progress[data.file] = { loaded: data.loaded, total: data.total };

          if (Object.keys(progress).length < 3) return;

          let loaded = 0;
          let total = 0;
          for (const val of Object.values(progress)) {
            loaded += val.loaded;
            total += val.total;
          }

          const percent = Math.round((loaded / total) * 100);
          postTypedMessage({
            type: "PROGRESS",
            progress: percent / 100,
            status: `Downloading model: ${percent}%`,
          });
        }
      },
    });
  }

  isInitialized = true;
  postTypedMessage({ type: "READY" });
}

async function processImage(src: string, maxNewTokens = 4096): Promise<void> {
  if (!processor || !model) {
    throw new Error("Model not initialized. Call INIT first.");
  }

  postTypedMessage({ type: "REPORT", status: "Loading image..." });
  const image = await load_image(src);

  postTypedMessage({ type: "REPORT", status: "Constructing prompt..." });

  // biome-ignore lint/suspicious/noExplicitAny: chat message format from transformers.js
  const messages: any[] = [
    {
      role: "user",
      content: [{ type: "image" }, { type: "text", text: "Convert this page to docling." }],
    },
  ];

  const text = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(text, [image], { do_image_splitting: true });

  postTypedMessage({ type: "REPORT", status: "Processing..." });

  let content = "";
  let tokens = 0;

  const tokenizer = processor.tokenizer;
  if (!tokenizer) {
    throw new Error("Tokenizer not available");
  }

  await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    streamer: new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: false,
      callback_function(streamedText: string) {
        tokens += 1;
        postTypedMessage({
          type: "STREAM",
          chunk: streamedText,
          progress: Math.min(tokens / maxNewTokens, 1),
        });
        content += streamedText;
      },
    }),
  });

  const cleanedContent = content.replace(/<\|end_of_text\|>$/, "");

  postTypedMessage({
    type: "DONE",
    text: cleanedContent,
    html: doclingToHtml(cleanedContent),
    markdown: doclingToMarkdown(cleanedContent),
    plainText: doclingToPlainText(cleanedContent),
    json: doclingToJson(cleanedContent),
    tables: extractTables(cleanedContent),
    overlays: extractOverlays(cleanedContent),
  });
}

type WorkerHandlerMap = {
  [K in WorkerMessageToWorker["type"]]: (
    data: Extract<WorkerMessageToWorker, { type: K }>
  ) => Promise<void>;
};

const MESSAGE_HANDLERS: WorkerHandlerMap = {
  INIT: async (data) => {
    setupCache();
    await loadModel(data.config);
  },
  PROCESS_FILE: async (data) => {
    if (!isInitialized) {
      throw new Error("Worker not initialized. Send INIT message first.");
    }
    await processImage(data.src, data.maxNewTokens);
  },
};

self.onmessage = async (event: MessageEvent<WorkerMessageToWorker>) => {
  try {
    const handler = MESSAGE_HANDLERS[event.data.type] as
      | ((data: WorkerMessageToWorker) => Promise<void>)
      | undefined;
    if (!handler) {
      throw new Error(`Unknown message type: ${event.data.type}`);
    }
    await handler(event.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postTypedMessage({ type: "ERROR", error: message });
  }
};
