/**
 * DoclingWebClient - Browser-based OCR client using Granite Docling model
 *
 * Implements DoclingClientBase by:
 * 1. Rendering PDF pages to images (via unpdf)
 * 2. Running OCR on each page via Web Worker
 * 3. Combining per-page results
 */

import { CrossEventEmitter } from "../platform/events";
import type {
  ConversionOptions,
  ConvertDocumentResponse,
  ConversionFileResult,
} from "../types/api";
import type {
  DoclingWeb,
  ProcessingError,
  SafeConversionResult,
  SafeFileConversionResult,
} from "../types/client";
import type {
  DoclingWebClientConfig,
  ImageInput,
  WebClientEvents,
  WebOCRResult,
  WebProcessOptions,
  WorkerMessageFromWorker,
} from "../types/web";
import { tryAsync } from "../utils/result";
import { clearModelCache, getModelCacheSize } from "../web/cache";
import { doclingToJson } from "../web/converters/json-converter";

export class DoclingWebClient implements DoclingWeb {
  public readonly type = "web" as const;

  private config: DoclingWebClientConfig;
  private events = new CrossEventEmitter<WebClientEvents>();
  private worker: Worker | null = null;
  private isReady = false;
  private isProcessing = false;

  constructor(config: DoclingWebClientConfig) {
    this.config = {
      device: "webgpu",
      modelId: "onnx-community/granite-docling-258M-ONNX",
      maxNewTokens: 4096,
      ...config,
    };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  get ready(): boolean {
    return this.isReady;
  }

  get processing(): boolean {
    return this.isProcessing;
  }

  async initialize(): Promise<void> {
    if (this.isReady) return;

    if (this.worker) {
      throw new Error("Initialization already in progress");
    }

    return new Promise((resolve, reject) => {
      const workerUrl = this.config.workerUrl ?? this.createWorkerBlobUrl();
      this.worker = new Worker(workerUrl, { type: "module" });

      const handleMessage = (event: MessageEvent<WorkerMessageFromWorker>) => {
        const message = event.data;

        switch (message.type) {
          case "PROGRESS":
            this.events.emit("loading", {
              progress: message.progress,
              status: message.status,
            });
            break;

          case "READY":
            this.isReady = true;
            this.events.emit("ready", undefined as unknown as undefined);
            resolve();
            break;

          case "ERROR": {
            const error = { message: message.error };
            this.events.emit("error", error);
            if (!this.isReady) {
              reject(new Error(message.error));
            }
            break;
          }
        }
      };

      this.worker.addEventListener("message", handleMessage);
      this.worker.addEventListener("error", (event) => {
        const error = { message: event.message || "Worker error" };
        this.events.emit("error", error);
        reject(new Error(error.message));
      });

      this.worker.postMessage({
        type: "INIT",
        config: this.config,
      });
    });
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.isProcessing = false;
    this.events.removeAllListeners();
  }

  // ============================================================================
  // Events
  // ============================================================================

  on<K extends keyof WebClientEvents>(
    event: K,
    callback: (data: WebClientEvents[K]) => void
  ): this {
    this.events.on(event, callback);
    return this;
  }

  off<K extends keyof WebClientEvents>(
    event: K,
    callback: (data: WebClientEvents[K]) => void
  ): this {
    this.events.off(event, callback);
    return this;
  }

  // ============================================================================
  // Cache
  // ============================================================================

  async clearCache(): Promise<boolean> {
    return clearModelCache();
  }

  async getCacheSize(): Promise<number> {
    return getModelCacheSize();
  }

  // ============================================================================
  // Web-specific: Direct image OCR
  // ============================================================================

  async processImage(input: ImageInput, options?: WebProcessOptions): Promise<WebOCRResult> {
    if (!this.worker || !this.isReady) {
      throw new Error("Client not initialized. Call initialize() first.");
    }

    if (this.isProcessing) {
      throw new Error("Already processing an image. Wait for completion.");
    }

    this.isProcessing = true;

    try {
      const src = await this.imageInputToDataUrl(input);

      return await new Promise<WebOCRResult>((resolve, reject) => {
        const handleMessage = (event: MessageEvent<WorkerMessageFromWorker>) => {
          const message = event.data;

          switch (message.type) {
            case "REPORT":
              this.events.emit("status", { status: message.status });
              break;

            case "STREAM":
              this.events.emit("stream", {
                chunk: message.chunk,
                progress: message.progress,
              });
              break;

            case "DONE": {
              this.isProcessing = false;
              const result: WebOCRResult = {
                raw: message.text,
                html: message.html,
                markdown: message.markdown,
                plainText: message.plainText,
                json: message.json,
                tables: message.tables,
                overlays: message.overlays,
              };
              this.events.emit("complete", result);
              this.worker?.removeEventListener("message", handleMessage);
              resolve(result);
              break;
            }

            case "ERROR": {
              this.isProcessing = false;
              const error = { message: message.error };
              this.events.emit("error", error);
              this.worker?.removeEventListener("message", handleMessage);
              reject(new Error(message.error));
              break;
            }
          }
        };

        this.worker?.addEventListener("message", handleMessage);

        this.worker?.postMessage({
          type: "PROCESS_FILE",
          src,
          maxNewTokens: options?.maxNewTokens ?? this.config.maxNewTokens,
        });
      });
    } catch (err) {
      this.isProcessing = false;
      throw err;
    }
  }

  // ============================================================================
  // DoclingClientBase implementation
  // ============================================================================

  async convert(
    file: Uint8Array | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();

    const results = await this.processFilePages(file, filename);
    return this.combineResults(results, filename, options);
  }

  async extractText(
    file: Uint8Array | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, { ...options, to_formats: ["text"] });
  }

  async toHtml(
    file: Uint8Array | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, { ...options, to_formats: ["html"] });
  }

  async toMarkdown(
    file: Uint8Array | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, { ...options, to_formats: ["md"] });
  }

  async convertDocument(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, options);
  }

  async process(
    file: Uint8Array | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, options);
  }

  async convertToFile(
    _file: Uint8Array | string,
    _filename: string,
    _options: ConversionOptions
  ): Promise<ConversionFileResult> {
    throw new Error("convertToFile is not supported by the web client. Use convert() instead.");
  }

  async safeConvert(
    file: Uint8Array | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<SafeConversionResult> {
    return tryAsync<ConvertDocumentResponse, ProcessingError>(() =>
      this.convert(file, filename, options)
    );
  }

  async safeConvertToFile(
    _file: Uint8Array | string,
    _filename: string,
    _options: ConversionOptions
  ): Promise<SafeFileConversionResult> {
    throw new Error("safeConvertToFile is not supported by the web client.");
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.isReady) {
      await this.initialize();
    }
  }

  private createWorkerBlobUrl(): string {
    const workerCode = `
      import('docling-sdk/web/worker').catch(err => {
        self.postMessage({ type: 'ERROR', error: err.message });
      });
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    return URL.createObjectURL(blob);
  }

  private async processFilePages(
    file: Uint8Array | string,
    filename: string
  ): Promise<WebOCRResult[]> {
    const ext = filename.split(".").pop()?.toLowerCase();
    const isPdf = ext === "pdf";

    if (isPdf) {
      const data = typeof file === "string" ? this.base64ToUint8Array(file) : file;
      const { renderPdfToImages } = await import("../web/pdf-renderer");
      const pages = await renderPdfToImages(data);
      const results: WebOCRResult[] = [];
      for (const page of pages) {
        results.push(await this.processImage(page.dataUrl));
      }
      return results;
    }

    // For images, process directly
    if (typeof file === "string") {
      // Assume it's a data URL or base64
      const src = file.startsWith("data:") ? file : `data:image/${ext};base64,${file}`;
      return [await this.processImage(src)];
    }

    // Uint8Array image - convert to data URL
    const blob = new Blob([file], { type: `image/${ext || "png"}` });
    return [await this.processImage(blob)];
  }

  private combineResults(
    results: WebOCRResult[],
    filename: string,
    _options?: ConversionOptions
  ): ConvertDocumentResponse {
    // Combine all page results into a single response
    const combinedRaw = results.map((r) => r.raw).join("\n\n");
    const combinedMarkdown = results.map((r) => r.markdown).join("\n\n---\n\n");
    const combinedText = results.map((r) => r.plainText).join("\n\n");
    const combinedHtml = results.map((r) => r.html).join("\n");

    // For JSON, combine into a single document
    const combinedJson = results.length === 1
      ? results[0]?.json
      : doclingToJson(combinedRaw, filename);

    return {
      document: {
        md_content: combinedMarkdown,
        html_content: combinedHtml,
        text_content: combinedText,
        json_content: combinedJson as unknown as Record<string, unknown>,
        doc_tags: combinedRaw,
      },
      errors: [],
      timings: {
        total: 0,
      },
    } as unknown as ConvertDocumentResponse;
  }

  private async imageInputToDataUrl(input: ImageInput): Promise<string> {
    if (typeof input === "string") {
      if (input.startsWith("data:")) {
        return input;
      }
      const response = await fetch(input);
      const blob = await response.blob();
      return this.blobToDataUrl(blob);
    }

    if (input instanceof Blob) {
      return this.blobToDataUrl(input);
    }

    if (typeof HTMLCanvasElement !== "undefined" && input instanceof HTMLCanvasElement) {
      return input.toDataURL("image/png");
    }

    if (typeof OffscreenCanvas !== "undefined" && input instanceof OffscreenCanvas) {
      const blob = await input.convertToBlob({ type: "image/png" });
      return this.blobToDataUrl(blob);
    }

    if (typeof HTMLImageElement !== "undefined" && input instanceof HTMLImageElement) {
      const canvas = document.createElement("canvas");
      canvas.width = input.naturalWidth || input.width;
      canvas.height = input.naturalHeight || input.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");
      ctx.drawImage(input, 0, 0);
      return canvas.toDataURL("image/png");
    }

    if (typeof ImageBitmap !== "undefined" && input instanceof ImageBitmap) {
      const canvas = document.createElement("canvas");
      canvas.width = input.width;
      canvas.height = input.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get canvas context");
      ctx.drawImage(input, 0, 0);
      return canvas.toDataURL("image/png");
    }

    throw new Error("Unsupported image input type");
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read blob"));
      reader.readAsDataURL(blob);
    });
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}
