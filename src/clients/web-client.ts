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
  ConversionFileResult,
  ConversionOptions,
  ConvertDocumentResponse,
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
  private workerBlobUrl: string | null = null;
  private initialization: Promise<void> | null = null;
  private pendingInit: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private pendingProcess: {
    resolve: (result: WebOCRResult) => void;
    reject: (error: Error) => void;
  } | null = null;

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

  initialize(): Promise<void> {
    if (this.isReady) return Promise.resolve();
    if (this.initialization) return this.initialization;
    const promise = new Promise<void>((resolve, reject) => {
      this.pendingInit = { resolve, reject };
      try {
        if (!this.config.workerUrl) this.workerBlobUrl = this.createWorkerBlobUrl();
        const url = this.config.workerUrl ?? this.workerBlobUrl ?? "";
        const worker = new Worker(url, { type: "module" });
        this.worker = worker;
        worker.addEventListener("message", (event: MessageEvent<WorkerMessageFromWorker>) => {
          if (this.worker !== worker) return;
          // Observer exceptions belong to browser event dispatch, not worker failure.
          this.handleWorkerMessage(event.data);
        });
        worker.addEventListener("error", (event) => {
          if (this.worker === worker) this.failWorker(new Error(event.message || "Worker error"));
        });
        worker.addEventListener("messageerror", () => {
          if (this.worker === worker)
            this.failWorker(new Error("Could not deserialize worker message"));
        });
        worker.postMessage({ type: "INIT", config: this.config });
      } catch (error) {
        this.failWorker(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.initialization = promise;
    const clear = () => {
      if (this.initialization === promise) this.initialization = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  private handleWorkerMessage(message: WorkerMessageFromWorker): void {
    switch (message.type) {
      case "PROGRESS":
        this.events.emit("loading", { progress: message.progress, status: message.status });
        break;
      case "READY": {
        this.isReady = true;
        const pending = this.pendingInit;
        this.pendingInit = null;
        this.revokeWorkerUrl();
        pending?.resolve();
        this.events.emit("ready", undefined);
        break;
      }
      case "REPORT":
        this.events.emit("status", { status: message.status });
        break;
      case "STREAM":
        this.events.emit("stream", { chunk: message.chunk, progress: message.progress });
        break;
      case "DONE": {
        const pending = this.pendingProcess;
        if (!pending) break;
        this.pendingProcess = null;
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
        pending.resolve(result);
        this.events.emit("complete", result);
        break;
      }
      case "ERROR": {
        const error = new Error(message.error);
        if (this.pendingInit) this.failWorker(error);
        else {
          const pending = this.pendingProcess;
          this.pendingProcess = null;
          this.isProcessing = false;
          pending?.reject(error);
          this.events.emit("error", { message: error.message });
        }
        break;
      }
    }
  }

  private revokeWorkerUrl(): void {
    if (this.workerBlobUrl !== null) URL.revokeObjectURL(this.workerBlobUrl);
    this.workerBlobUrl = null;
  }

  private releaseWorker(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.isReady = false;
    this.isProcessing = false;
    this.pendingInit?.reject(error);
    this.pendingInit = null;
    this.pendingProcess?.reject(error);
    this.pendingProcess = null;
    this.initialization = null;
    worker?.terminate();
    this.revokeWorkerUrl();
  }

  private failWorker(error: Error): void {
    this.releaseWorker(error);
    this.events.emit("error", { message: error.message });
  }

  destroy(): void {
    this.releaseWorker(new Error("Client destroyed"));
    this.events.removeAllListeners();
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Subscribe to synchronous notifications. During worker message dispatch, a
   * thrown callback error reaches the browser's uncaught-error reporting and
   * skips later callbacks for that notification; it does not fail OCR or terminate
   * the worker. Async callback results and rejections are not awaited or handled.
   */
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
    const worker = this.worker;
    return new Promise<WebOCRResult>((resolve, reject) => {
      const pending = { resolve, reject };
      this.pendingProcess = pending;
      void this.imageInputToDataUrl(input)
        .then((src) => {
          if (this.worker !== worker || this.pendingProcess !== pending) return;
          worker.postMessage({
            type: "PROCESS_FILE",
            src,
            maxNewTokens: options?.maxNewTokens ?? this.config.maxNewTokens,
          });
        })
        .catch((error) => {
          if (this.pendingProcess !== pending) return;
          this.pendingProcess = null;
          this.isProcessing = false;
          reject(error);
        });
    });
  }

  // ============================================================================
  // DoclingClientBase implementation
  // ============================================================================

  async convert(
    file: Uint8Array | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    const extension = filename.split(".").pop()?.toLowerCase();
    if (
      !extension ||
      !["pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif", "svg"].includes(
        extension
      )
    ) {
      throw new Error(
        `Unsupported web input format: ${extension ?? filename}. Use PDF or an image.`
      );
    }
    if (options?.to_formats?.some((format) => format === "html_split_page")) {
      throw new Error("html_split_page is not supported by the web client. Use html instead.");
    }
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
    // Use Function constructor to completely hide the dynamic import() from
    // bundler static analysis. Bundlers (webpack, rollup, esbuild) parse source
    // code for import() calls and try to resolve them — even inside strings and
    // template literals. Using Function() ensures the import() only exists at
    // runtime inside the blob Worker context.
    const workerCode = [
      "const pending=[];",
      "self.onmessage=event=>pending.push(event);",
      "const m='docling-sdk/web/worker';",
      "Function('m','return import(m)')(m).then(()=>{",
      "  const handle=self.onmessage;",
      "  for(const event of pending)handle?.(event);",
      "}).catch(err=>{",
      "  self.postMessage({type:'ERROR',error:err.message});",
      "});",
    ].join("");
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
      const data =
        typeof file === "string"
          ? this.base64ToUint8Array(file.replace(/^data:application\/pdf;base64,/i, ""))
          : file;
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
    const combinedJson =
      results.length === 1 ? results[0]?.json : doclingToJson(combinedRaw, filename);

    return {
      status: "success",
      processing_time: 0,
      document: {
        filename,
        md_content: combinedMarkdown,
        html_content: combinedHtml,
        text_content: combinedText,
        json_content:
          combinedJson as unknown as ConvertDocumentResponse["document"]["json_content"],
        doctags_content: combinedRaw,
        ...{ doc_tags: combinedRaw },
      },
      errors: [],
      timings: {
        total: 0,
      },
    };
  }

  private async imageInputToDataUrl(input: ImageInput): Promise<string> {
    if (typeof input === "string") {
      if (input.startsWith("data:")) {
        return input;
      }
      const response = await fetch(input);
      if (!response.ok)
        throw new Error(`Image fetch failed: ${response.status} ${response.statusText}`);
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
