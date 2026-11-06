import { EventEmitter } from "node:events";
import { constants, createWriteStream, realpathSync, type Stats } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { Readable, type Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { watch as chokidarWatch } from "chokidar";
import type {
  ConversionFileResult,
  ConversionOptions,
  ConversionStatus,
  ConvertDocumentResponse,
  ExportDocumentResponse,
  InputFormat,
  OutputFormat,
  ProcessingError,
} from "../types/api";
import type { CliConversionResult, CliConvertOptions } from "../types/cli";

import {
  ProcessAbortError,
  ProcessTimeoutError,
  type ProcessRunOptions,
  type ProcessRunResult,
  runProcess,
} from "../cli/process-runner";
import type {
  DoclingCLI,
  DoclingCLIConfig,
  ProgressConfig,
  ProgressUpdate,
  SafeConversionResult,
  SafeFileConversionResult,
} from "../types/client";
import type { NodeReadable } from "../types/streams";
import { tryAsync } from "../utils/result";

type ArgumentBuilderFunction = (value: unknown) => string[];

function executablePath(executable: string): string {
  return /[\\/]/.test(executable) ? resolve(executable) : executable;
}

interface ValidatedOutput {
  format: OutputFormat;
  path: string;
  name: string;
  content: string;
  value: string | NonNullable<ExportDocumentResponse["json_content"]>;
  assets: Array<{ path: string; name: string; bytes: Buffer }>;
}

interface ConversionJob {
  directory: string;
  outputs: ValidatedOutput[];
  errors: ProcessingError[];
  status: ConversionStatus;
  stdout: string;
  stderr: string;
  exitCode: number;
  started: number;
}

type CliBatchOptions = ConversionOptions & {
  outputDir?: string;
  parallel?: boolean;
  maxConcurrency?: number;
};

interface CliBatchResult {
  success: boolean;
  results: Array<{ file: string; success: boolean; output?: string; error?: string }>;
}

/**
 * CLI Client Implementation
 * Implements the DoclingCLI interface
 * Calls the actual Docling Python CLI binary for real document processing
 */
export class DoclingCLIClient implements DoclingCLI {
  public readonly type = "cli" as const;
  private config: DoclingCLIConfig;
  public readonly progress: EventEmitter;
  private outputDir: string;
  private pythonPath: string;
  private doclingCommand: string;
  private commandPrefix: string[] = [];
  private readonly watchStops = new Set<() => void>();
  private readonly jobRoots = new Set<string>();
  /**
   * Private static maps for format lookups (consistent with API client)
   */
  private static readonly FORMAT_TO_EXTENSION_MAP: ReadonlyMap<string, string> = new Map<
    string,
    string
  >([
    ["text", "txt"],
    ["html", "html"],
    ["html_split_page", "html"],
    ["md", "md"],
    ["json", "json"],
    ["doctags", "doctags"],
  ]);

  private static readonly FORMAT_TO_CONTENT_KEY_MAP: ReadonlyMap<string, string> = new Map<
    string,
    string
  >([
    ["text", "text_content"],
    ["html", "html_content"],
    ["html_split_page", "html_content"],
    ["md", "md_content"],
    ["json", "json_content"],
    ["doctags", "doctags_content"],
  ]);

  constructor(config: DoclingCLIConfig = { type: "cli" }) {
    this.config = config;
    this.progress = new EventEmitter();
    this.outputDir = config.outputDir || "./output";
    this.pythonPath = executablePath(config.pythonPath || "python3");
    this.doclingCommand = executablePath(config.doclingPath || "docling");
    this.initializePromise = null;
  }

  private initializePromise: Promise<void> | null;

  /**
   * Get current CLI configuration
   */
  public getConfig(): DoclingCLIConfig {
    return { ...this.config };
  }

  /**
   * Update CLI configuration
   */
  public updateConfig(newConfig: Partial<DoclingCLIConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.outputDir !== undefined) this.outputDir = newConfig.outputDir;
    if (newConfig.pythonPath !== undefined) this.pythonPath = executablePath(newConfig.pythonPath);
    if (newConfig.doclingPath !== undefined || newConfig.pythonPath !== undefined) {
      this.doclingCommand = executablePath(this.config.doclingPath || "docling");
      this.commandPrefix = [];
      this.initializePromise = null;
    }
  }

  /**
   * Build arguments for a convert-like command
   * This uses the same internal argument mapping as execution
   */
  public buildConvertArgs(options: CliConvertOptions): string[] {
    const core = this.buildCliArgs(options);
    return ["convert", ...core];
  }

  /**
   * Build arguments for model download via docling-tools
   */
  public buildModelDownloadArgs(options: {
    outputDir?: string;
    force?: boolean;
    models?: string[];
    all?: boolean;
    quiet?: boolean;
  }): string[] {
    const args: string[] = ["models", "download"];

    if (options.outputDir) args.push("--output-dir", String(options.outputDir));
    if (options.force) args.push("--force");
    if (options.all) args.push("--all");
    if (options.quiet) args.push("--quiet");

    if (options.models?.length) {
      for (const m of options.models) args.push(String(m));
    }

    return args;
  }

  /**
   * Initialize and verify Docling CLI is available
   */
  async initialize(): Promise<void> {
    try {
      const version = await this.getVersion();
      this.progress.emit("docling-detected", { version });
      this.progress.emit("initialized", { status: "ready" });
    } catch (error) {
      const details = { message: "Failed to initialize Docling CLI", error };
      this.progress.emit("initialization-error", details);
      this.progress.emit("docling-not-found", { error });
      if (this.progress.listenerCount("error") > 0) this.progress.emit("error", details);
      throw error;
    }
  }

  /**
   * Check if Docling CLI is available and working
   */
  async checkAvailability(): Promise<boolean> {
    try {
      const version = await this.getVersion();
      this.progress.emit("docling-detected", { version });
      return true;
    } catch (error) {
      this.progress.emit("docling-not-found", { error });
      return false;
    }
  }

  /**
   * Get Docling version information
   */
  async getVersion(): Promise<string> {
    const configured = this.config.doclingPath || "docling";
    const candidates = [{ executable: executablePath(configured), prefix: [] as string[] }];
    // A module name is distinct from an executable path. Never split either on spaces.
    if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(configured)) {
      candidates.push({ executable: this.pythonPath, prefix: ["-m", configured] });
    }
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const result = await runProcess(candidate.executable, [...candidate.prefix, "--version"], {
          timeout: this.config.timeout ?? 300000,
          maxBuffer: 10 * 1024 * 1024,
        });
        if (!result.success) throw this.processError(result);
        this.doclingCommand = candidate.executable;
        this.commandPrefix = candidate.prefix;
        return result.stdout.trim();
      } catch (error) {
        lastError = error;
        // Cancellation, timeout, and output limits must never trigger a fallback execution.
        if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
    throw (
      lastError || new Error("Docling CLI not found. Please install Docling: pip install docling")
    );
  }

  /**
   * Ensure CLI is initialized before processing
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initialize().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    await this.initializePromise;
  }

  /**
   * Merge per-call options with client defaults
   */
  private mergeWithDefaults(options?: ConversionOptions): ConversionOptions {
    return {
      ...this.config.defaultOptions,

      ...(this.config.ocr_engine && { ocr_engine: this.config.ocr_engine }),
      ...(this.config.ocr_options && { ocr_options: this.config.ocr_options }),
      ...(this.config.pdf_backend && { pdf_backend: this.config.pdf_backend }),
      ...(this.config.table_mode && { table_mode: this.config.table_mode }),
      ...(this.config.pipeline && { pipeline: this.config.pipeline }),
      ...(this.config.accelerator_options && {
        accelerator_options: this.config.accelerator_options,
      }),
      ...(this.config.layout_options && {
        layout_options: this.config.layout_options,
      }),

      ...options,
    };
  }

  /**
   * Convert document to various formats
   */
  async convert(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();
    return this.processFile(file, filename, this.mergeWithDefaults(options));
  }

  /**
   * Extract text content from document
   */
  async extractText(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConvertDocumentResponse> {
    return this.processFile(
      file,
      filename,
      this.mergeWithDefaults({
        ...options,
        to_formats: ["text"],
      })
    );
  }

  /**
   * Convert document to HTML format
   */
  async toHtml(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConvertDocumentResponse> {
    return this.processFile(
      file,
      filename,
      this.mergeWithDefaults({
        ...options,
        to_formats: ["html"],
      })
    );
  }

  /**
   * Convert document to Markdown format
   */
  async toMarkdown(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConvertDocumentResponse> {
    return this.processFile(
      file,
      filename,
      this.mergeWithDefaults({
        ...options,
        to_formats: ["md"],
      })
    );
  }

  /**
   * Convert document to multiple formats
   */
  async convertDocument(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    return this.processFile(file, filename, this.mergeWithDefaults(options));
  }

  /**
   * Process document with advanced options
   */
  async process(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    return this.processFile(file, filename, this.mergeWithDefaults(options));
  }

  /**
   * Convert document and return as downloadable files (ZIP)
   */
  async convertToFile(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionFileResult> {
    let job: ConversionJob | undefined;
    try {
      await this.ensureInitialized();
      job = await this.runDocumentJob(file, filename, this.mergeWithDefaults(options));
      if (job.status !== "success") {
        return {
          success: false,
          error: { message: `Conversion ${job.status}`, details: job.errors },
        };
      }
      const zipBuffer = await this.createZipFromOutputs(job.outputs);
      return {
        success: true,
        fileStream: this.createBufferStream(zipBuffer),
        fileMetadata: {
          filename: `${basename(filename, extname(filename))}.zip`,
          contentType: "application/zip",
          size: zipBuffer.length,
        },
      };
    } catch (error) {
      return { success: false, error: { message: "Failed to create ZIP file", details: error } };
    } finally {
      if (job) await this.cleanupTempDirectory(job.directory);
    }
  }

  /**
   * Convert using SYNC approach
   * For CLI, this is the same as convert() since CLI calls are synchronous
   */
  async convertSync(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();
    return this.processFile(file, filename, this.mergeWithDefaults(options));
  }

  /**
   * Convert using ASYNC approach (CLI with background processing)
   * For CLI, we can simulate async by running in background
   */
  async convertAsync(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();

    this.progress.emit("async-start", { file: filename });

    const result = await this.processFile(file, filename, this.mergeWithDefaults(options));

    this.progress.emit("async-complete", {
      file: filename,
      success: result.status === "success",
      status: result.status,
    });

    return result;
  }

  /**
   * Convert input stream (CLI processes stream by saving to temp file)
   */
  async convertStream(
    inputStream: NodeJS.ReadableStream,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();

    try {
      const buffer = await this.streamToBuffer(inputStream);

      this.progress.emit("stream-converted", {
        filename,
        size: buffer.length,
      });

      return this.processFile(buffer, filename, this.mergeWithDefaults(options));
    } catch (error) {
      throw new Error(
        `Failed to process input stream: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Convert input stream to ZIP file
   */
  async convertStreamToFile(
    inputStream: NodeJS.ReadableStream,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionFileResult> {
    await this.ensureInitialized();

    try {
      const buffer = await this.streamToBuffer(inputStream);

      this.progress.emit("stream-converted", {
        filename,
        size: buffer.length,
      });

      return this.convertToFile(buffer, filename, options);
    } catch (error) {
      return {
        success: false,
        error: {
          message: "Failed to process input stream to file",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Convert and validate all requested outputs before writing to the destination.
   * This prevents a failed process from publishing incomplete files.
   * @param returnAsZip - If true, returns ZIP file; if false, returns content directly
   */
  async convertToStream(
    options: CliConvertOptions,
    outputStream: Writable,
    returnAsZip = false
  ): Promise<CliConversionResult> {
    const controller = new AbortController();
    const destinationMonitor = new AbortController();
    let destinationError: unknown;
    let endingDestination = false;
    const failDestination = (error: unknown) => {
      destinationError = error;
      controller.abort();
    };
    // Observe failure from the start, including disconnects during conversion.
    // Handle rejection immediately so it never becomes unhandled.
    const destination = finished(outputStream, {
      cleanup: true,
      readable: false,
      signal: destinationMonitor.signal,
    }).then(() => {
      if (!endingDestination)
        failDestination(new Error("Destination finished before conversion completed"));
    }, failDestination);
    let job: ConversionJob | undefined;
    try {
      await this.ensureInitialized();
      job = await this.runCliJob(options, undefined, controller.signal);
      const result = this.cliJobResult(job);
      if (!returnAsZip && job.outputs.some((output) => output.assets.length > 0)) {
        throw new Error("Referenced image assets require ZIP output when streaming");
      }
      const content = result.success
        ? returnAsZip
          ? await this.createZipFromOutputs(job.outputs)
          : Buffer.from(job.outputs.map((output) => output.content).join(""))
        : undefined;
      if (destinationError) throw destinationError;
      endingDestination = true;
      outputStream.end(content);
      await destination;
      if (destinationError) throw destinationError;
      return { ...result, outputFiles: [] };
    } catch (error) {
      // End our ownership of the destination and remove finished() listeners even
      // when input validation or conversion rejects before any output is written.
      const failure = destinationError ?? error;
      outputStream.destroy();
      // A Writable may suppress close events. Cancel observation on job failure.
      destinationMonitor.abort();
      await destination;
      throw failure;
    } finally {
      if (job) await this.cleanupTempDirectory(job.directory);
    }
  }

  /** Run conversion with progress from the same bounded process runner as convert(). */
  async convertWithProgress(
    options: CliConvertOptions,
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      memoryUsage?: NodeJS.MemoryUsage;
    }) => void
  ): Promise<CliConversionResult> {
    await this.ensureInitialized();
    let job: ConversionJob | undefined;
    try {
      job = await this.runCliJob(options, (message) => {
        const percent = message.match(/(\d+)%/);
        onProgress?.({
          stage: "processing",
          message: message.trim(),
          ...(percent?.[1] && { percentage: Number.parseInt(percent[1], 10) }),
        });
      });
      const result = this.cliJobResult(job);
      onProgress?.({
        stage: result.success ? "completed" : "failed",
        percentage: 100,
        message: `Conversion ${job.status}`,
      });
      if (job.outputs.length === 0) await this.cleanupTempDirectory(job.directory);
      return result;
    } catch (error) {
      if (job) await this.cleanupTempDirectory(job.directory);
      onProgress?.({
        stage: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Convert with automatic progress tracking using config callbacks
   * Uses the progress config from constructor to automatically handle progress
   * @param progressOverride - Optional progress config to override client config
   */
  async convertWithAutoProgress(
    options: CliConvertOptions,
    progressOverride?: ProgressConfig
  ): Promise<CliConversionResult> {
    const progressConfig = progressOverride || this.config.progress;

    if (!progressConfig) {
      return this.convertWithProgress(options);
    }

    try {
      const result = await this.convertWithProgress(options, (progress) => {
        const progressUpdate: ProgressUpdate = {
          stage: progress.stage,
          ...(progress.percentage !== undefined && {
            percentage: progress.percentage,
          }),
          ...(progress.message && { message: progress.message }),
          timestamp: Date.now(),
          ...(progress.memoryUsage && { memoryUsage: progress.memoryUsage }),
        };

        try {
          progressConfig.onProgress?.(progressUpdate);
        } catch (error) {
          console.error("Error in progress callback:", error);
        }
      });

      try {
        await progressConfig.onComplete?.(result);
      } catch (error) {
        console.error("Error in completion callback:", error);
      }

      return result;
    } catch (error) {
      try {
        await progressConfig.onError?.(error as Error);
      } catch (callbackError) {
        console.error("Error in error callback:", callbackError);
      }
      throw error;
    }
  }

  /**
   * Health check (CLI version of API health())
   * Combines availability check and version info
   */
  async health(): Promise<{ status: string; version?: string }> {
    try {
      const isAvailable = await this.checkAvailability();
      if (!isAvailable) {
        return { status: "unavailable" };
      }

      const version = await this.getVersion();
      return {
        status: "available",
        version: version,
      };
    } catch (error) {
      return {
        status: "error",
        version: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Convert from URL (CLI version of API convertFromUrl())
   * Downloads the file and converts it
   */
  async convertFromUrl(
    url: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();

    const tempDir = await this.createTempDirectory();
    try {
      const { filename, path: tempFilePath } = await this.downloadFile(url, tempDir);

      this.progress.emit("url-downloaded", { url, tempFilePath });

      const result = await this.processFile(
        tempFilePath,
        filename,
        this.mergeWithDefaults(options)
      );

      return result;
    } catch (error) {
      if (error instanceof ProcessAbortError) throw error;
      throw new Error(
        `Failed to convert from URL: ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      await this.cleanupTempDirectory(tempDir);
    }
  }

  /**
   * Convert from file path
   * Direct file processing
   */
  async convertFromFile(
    filePath: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();

    try {
      const filename = basename(filePath);
      return this.processFile(filePath, filename, this.mergeWithDefaults(options));
    } catch (error) {
      throw new Error(
        `Failed to convert file: ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Convert from buffer
   * Creates temp file and converts
   */
  async convertFromBuffer(
    buffer: Buffer,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();

    try {
      return this.processFile(buffer, filename, this.mergeWithDefaults(options));
    } catch (error) {
      throw new Error(
        `Failed to convert buffer for file: ${filename}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Convert from base64
   * Decodes base64 and converts buffer
   */
  async convertFromBase64(
    base64String: string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    try {
      const buffer = Buffer.from(base64String, "base64");
      return this.convertFromBuffer(buffer, filename, options);
    } catch (error) {
      throw new Error(
        `Failed to convert base64 for file: ${filename}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Convert multiple files
   */
  async convertMultipleFiles(
    files: Array<{ buffer?: Buffer; filePath?: string; filename: string }>,
    options: ConversionOptions = {},
    onProgress?: (progress: {
      stage: string;
      currentFile: number;
      totalFiles: number;
      filename: string;
      percentage: number;
    }) => void
  ): Promise<{
    success: boolean;
    results: Array<{
      filename: string;
      success: boolean;
      result?: ConvertDocumentResponse;
      error?: string;
    }>;
  }> {
    await this.ensureInitialized();

    const settled = await Promise.allSettled(
      files.map((file, index) =>
        this.processSingleFile(file, index, files.length, options, onProgress)
      )
    );
    const results = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });

    const successCount = results.filter((r) => r.success).length;

    if (onProgress) {
      onProgress({
        stage: "completed",
        currentFile: files.length,
        totalFiles: files.length,
        filename: "all files",
        percentage: 100,
      });
    }

    return {
      success: successCount === files.length,
      results,
    };
  }

  /**
   * Watch directory for file changes and auto-convert
   */
  async watch(
    directory: string,
    options?: {
      outputDir?: string;
      recursive?: boolean;
      patterns?: string[];
      debounce?: number;
    }
  ): Promise<void> {
    const watchOptions = {
      outputDir: options?.outputDir ?? this.outputDir,
      recursive: options?.recursive ?? true,
      patterns: options?.patterns ?? ["**/*.pdf", "**/*.docx", "**/*.pptx"],
      debounce: options?.debounce ?? 1000,
    };
    if (
      !Number.isFinite(watchOptions.debounce) ||
      watchOptions.debounce < 0 ||
      watchOptions.debounce > 2 ** 31 - 1
    ) {
      throw new RangeError("Watch debounce must be between 0 and 2147483647 milliseconds");
    }
    this.progress.emit("watch-start", { directory, options: watchOptions });
    const ignored = (path: string) =>
      /(^|[/\\])\../.test(path) || this.isJobPath(path, watchOptions.outputDir);
    const watcher = chokidarWatch(directory, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      ...(watchOptions.recursive ? {} : { depth: 0 }),
    });
    const timers = new Map<string, NodeJS.Timeout>();
    const convertWatched = async (filePath: string) => {
      try {
        const result = await this.processFile(
          filePath,
          basename(filePath),
          this.mergeWithDefaults(),
          watchOptions.outputDir
        );
        this.progress.emit("file-processed", {
          file: filePath,
          success: result.status === "success",
          status: result.status,
        });
      } catch (error) {
        this.progress.emit("file-processed", { file: filePath, success: false, error });
      }
    };
    const onAdd = (filePath: string) => {
      if (ignored(filePath) || !this.shouldProcessFile(filePath, watchOptions.patterns)) return;
      this.progress.emit("file-detected", { file: filePath });
      void convertWatched(filePath);
    };
    const onChange = (filePath: string) => {
      if (ignored(filePath) || !this.shouldProcessFile(filePath, watchOptions.patterns)) return;
      this.progress.emit("file-changed", { file: filePath });
      clearTimeout(timers.get(filePath));
      timers.set(
        filePath,
        setTimeout(() => {
          timers.delete(filePath);
          void convertWatched(filePath);
        }, watchOptions.debounce)
      );
    };
    return new Promise<void>((resolveWatch, rejectWatch) => {
      let stopped = false;
      const stop = (error?: unknown) => {
        if (stopped) return;
        stopped = true;
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        watcher.off("add", onAdd);
        watcher.off("change", onChange);
        watcher.off("error", onError);
        this.watchStops.delete(stop);
        void (async () => {
          const closing = watcher.close();
          let observerFailure: { error: unknown } | undefined;
          try {
            this.progress.emit("watch-stop");
          } catch (error) {
            observerFailure = { error };
          }
          await closing;
          if (error !== undefined) throw error;
          if (observerFailure) throw observerFailure.error;
        })().then(resolveWatch, rejectWatch);
      };
      const onSignal = () => stop();
      const onError = (error: unknown) => stop(error);
      this.watchStops.add(stop);
      watcher.on("add", onAdd);
      watcher.on("change", onChange);
      watcher.on("error", onError);
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
    });
  }

  /**
   * Process multiple files in batch
   */
  async batch(files: string[], options?: CliBatchOptions): Promise<CliBatchResult> {
    return this.runBatch(files, options);
  }

  private async runBatch(
    files: string[],
    options?: CliBatchOptions,
    onConverted?: (file: string, result: ConvertDocumentResponse) => void
  ): Promise<CliBatchResult> {
    const batchOptions = {
      outputDir: options?.outputDir ?? this.outputDir,
      parallel: options?.parallel ?? true,
      maxConcurrency: options?.maxConcurrency ?? this.config.concurrency ?? 4,
    };
    if (!Number.isSafeInteger(batchOptions.maxConcurrency) || batchOptions.maxConcurrency < 1) {
      throw new RangeError("maxConcurrency must be a positive safe integer");
    }
    this.progress.emit("batch-start", { files: files.length, options: batchOptions });

    const convertFile = async (file: string) => {
      try {
        const result = await this.processFile(
          file,
          basename(file),
          this.mergeWithDefaults(options),
          batchOptions.outputDir
        );
        onConverted?.(file, result);
        const success = result.status === "success";
        this.progress.emit("file-completed", { file, success, status: result.status });
        return {
          file,
          success,
          ...(success
            ? { output: "Converted successfully" }
            : {
                error:
                  result.errors?.map((error) => error.message).join("; ") ||
                  `Conversion ${result.status}`,
              }),
        };
      } catch (error) {
        if (error instanceof ProcessAbortError) throw error;
        this.progress.emit("file-completed", { file, success: false });
        return {
          file,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    const results: Array<{ file: string; success: boolean; output?: string; error?: string }> = [];
    const concurrency = batchOptions.parallel ? batchOptions.maxConcurrency : 1;
    for (let index = 0; index < files.length; index += concurrency) {
      // A cancelled chunk must finish every started job's cleanup before rejecting.
      const settled = await Promise.allSettled(
        files.slice(index, index + concurrency).map(convertFile)
      );
      for (const result of settled) {
        if (result.status === "rejected") throw result.reason;
        results.push(result.value);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    this.progress.emit("batch-complete", {
      total: files.length,
      success: successCount,
      failed: files.length - successCount,
    });

    return {
      success: successCount === files.length,
      results,
    };
  }

  /**
   * Process directory with options (programmatic, no user interaction)
   */
  async processDirectory(
    directoryPath: string,
    options?: ConversionOptions
  ): Promise<{
    success: boolean;
    results: ConvertDocumentResponse[];
    totalFiles: number;
  }> {
    try {
      const dirStat = await stat(directoryPath);
      if (!dirStat.isDirectory()) {
        throw new Error(`Path is not a directory: ${directoryPath}`);
      }

      const files = await readdir(directoryPath);
      const pdfFiles = files.filter((file: string) => extname(file).toLowerCase() === ".pdf");

      if (pdfFiles.length === 0) {
        return {
          success: true,
          results: [],
          totalFiles: 0,
        };
      }

      const filePaths = pdfFiles.map((file: string) => join(directoryPath, file));
      const conversions = new Map<string, ConvertDocumentResponse>();
      const batchResult = await this.runBatch(filePaths, options, (file, result) => {
        conversions.set(file, result);
      });
      const conversionResults = batchResult.results.flatMap((result) => {
        const converted = conversions.get(result.file);
        return result.success && converted
          ? [{ ...converted, document: { ...converted.document, filename: result.file } }]
          : [];
      });

      return {
        success: batchResult.success,
        results: conversionResults,
        totalFiles: pdfFiles.length,
      };
    } catch (error) {
      if (error instanceof ProcessAbortError) throw error;
      return {
        success: false,
        results: [],
        totalFiles: 0,
      };
    }
  }

  /**
   * Set output directory for CLI operations
   */
  setOutputDir(dir: string): void {
    this.outputDir = dir;
    this.config.outputDir = dir;
  }

  /**
   * Validate input files
   */
  async validateFiles(files: string[]): Promise<{
    valid: string[];
    invalid: Array<{ file: string; reason: string }>;
  }> {
    const valid: string[] = [];
    const invalid: Array<{ file: string; reason: string }> = [];

    for (const file of files) {
      try {
        const stats = await stat(file);

        if (!stats.isFile()) {
          invalid.push({ file, reason: "Not a file" });
          continue;
        }

        const ext = extname(file).toLowerCase();
        const supportedExtensions = [".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".md"];

        if (!supportedExtensions.includes(ext)) {
          invalid.push({ file, reason: `Unsupported file type: ${ext}` });
          continue;
        }

        valid.push(file);
      } catch (error) {
        invalid.push({
          file,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { valid, invalid };
  }

  /**
   * Validate CLI configuration and options
   */
  private validateConfiguration(options?: ConversionOptions): void {
    if (!options) return;

    const numericValidations = new Map([
      ["document_timeout", { min: 1, max: 3600, name: "Document timeout" }],
      ["num_threads", { min: 1, max: 32, name: "Number of threads" }],
      ["images_scale", { min: 0.1, max: 10, name: "Images scale" }],
      ["ocr_confidence", { min: 0, max: 1, name: "OCR confidence" }],
      ["verbose", { min: 0, max: 3, name: "Verbose level" }],
    ]);

    for (const [key, validation] of numericValidations) {
      const value = (options as Record<string, unknown>)[key];
      if (value !== undefined) {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < validation.min ||
          value > validation.max ||
          ((key === "num_threads" || key === "verbose") && !Number.isSafeInteger(value))
        ) {
          throw new Error(
            `${validation.name} must be between ${validation.min} and ${validation.max}, got ${value}`
          );
        }
      }
    }

    const enumValidations = new Map([
      ["pdf_backend", ["dlparse_v1", "dlparse_v2", "dlparse_v4", "pypdfium2"]],
      ["table_mode", ["fast", "accurate"]],
      ["device", ["auto", "cpu", "cuda", "mps"]],
      ["ocr_engine", ["easyocr", "tesseract", "tesserocr", "rapidocr", "ocrmac"]],
      ["pipeline", ["standard", "vlm", "asr"]],
      ["image_export_mode", ["placeholder", "embedded", "referenced"]],
    ]);

    for (const [key, validValues] of enumValidations) {
      const value = (options as Record<string, unknown>)[key];
      if (value !== undefined && !validValues.includes(value as string)) {
        throw new Error(`Invalid ${key}: ${value}. Valid options: ${validValues.join(", ")}`);
      }
    }

    if (options.to_formats) {
      const validFormats = [...DoclingCLIClient.FORMAT_TO_EXTENSION_MAP.keys()];
      const invalidFormats = options.to_formats.filter((f) => !validFormats.includes(f));
      if (invalidFormats.length > 0) {
        throw new Error(
          `Invalid output formats: ${invalidFormats.join(
            ", "
          )}. Valid formats: ${validFormats.join(", ")}`
        );
      }
    }

    if (options.ocr_lang) {
      const validLanguages = [
        "eng",
        "fra",
        "deu",
        "spa",
        "ita",
        "por",
        "rus",
        "chi_sim",
        "chi_tra",
        "jpn",
        "kor",
      ];
      const invalidLanguages = options.ocr_lang.filter((lang) => !validLanguages.includes(lang));
      if (invalidLanguages.length > 0) {
        console.warn(
          `Warning: Unrecognized OCR languages: ${invalidLanguages.join(
            ", "
          )}. Common languages: ${validLanguages.join(", ")}`
        );
      }
    }

    if (options.page_range && Array.isArray(options.page_range)) {
      const [start, end] = options.page_range;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        throw new Error(
          `Invalid page range: [${start}, ${end}]. Start must be >= 1 and end must be >= start`
        );
      }
    }

    if (options.do_ocr === false && options.ocr_engine) {
      console.warn("Warning: OCR engine specified but OCR is disabled");
    }

    const extendedOptions = options as Record<string, unknown>;
    if (extendedOptions.quiet && extendedOptions.verbose) {
      throw new Error("Cannot specify both quiet and verbose options");
    }
  }

  /**
   * Get environment-specific default options
   */
  private getEnvironmentDefaults(): Record<string, string | number | boolean> {
    const isProduction = process.env.NODE_ENV === "production";
    const isDevelopment = process.env.NODE_ENV === "development";

    return {
      ...(isProduction && {
        verbose: 0,
        abort_on_error: true,
        num_threads: 4,
        document_timeout: 300,
      }),

      ...(isDevelopment && {
        verbose: 1,
        abort_on_error: false,
        num_threads: 2,
        document_timeout: 600,
      }),

      pdf_backend: "dlparse_v2",
      table_mode: "accurate",
      device: "auto",
      pipeline: "standard",
    };
  }

  /**
   * Merge options with environment defaults and validate
   */
  private prepareOptions(options?: ConversionOptions): ConversionOptions {
    const environmentDefaults = this.getEnvironmentDefaults();
    const mergedOptions = {
      ...environmentDefaults,
      ...(options?.accelerator_options?.device !== undefined && {
        device: options.accelerator_options.device,
      }),
      ...(options?.accelerator_options?.num_threads !== undefined && {
        num_threads: options.accelerator_options.num_threads,
      }),
      ...(options?.table_structure_options?.mode !== undefined && {
        table_mode: options.table_structure_options.mode,
      }),
      ...options,
      ...(options?.ocr_options && {
        ocr_engine: options.ocr_engine ?? options.ocr_options.kind,
        ocr_lang: options.ocr_lang ?? options.ocr_options.lang,
        force_ocr: options.force_ocr ?? options.ocr_options.force_full_page_ocr,
      }),
    };

    this.validateConfiguration(mergedOptions);

    return mergedOptions;
  }

  /**
   * Create a readable stream from a buffer
   */
  private createBufferStream(buffer: Buffer): NodeReadable {
    return Readable.from(buffer);
  }

  /**
   * Safe Methods using Result Pattern
   */

  /**
   * Safe convert method using Result pattern
   */
  async safeConvert(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<SafeConversionResult> {
    return tryAsync(async () => {
      return this.convert(file, filename, options);
    });
  }

  /**
   * Safe convert to file method using Result pattern
   */
  async safeConvertToFile(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<SafeFileConversionResult> {
    return tryAsync(async () => {
      return this.convertToFile(file, filename, options);
    });
  }

  /**
   * Build CLI arguments from CliConvertOptions
   */
  private buildCliArgs(options: CliConvertOptions): string[] {
    const args: string[] = [];

    if (options.fromFormats && options.fromFormats.length > 0) {
      for (const format of options.fromFormats) args.push("--from", String(format));
    }
    if (options.toFormats && options.toFormats.length > 0) {
      for (const format of options.toFormats) args.push("--to", String(format));
    }
    if (options.output) {
      args.push("--output", String(options.output));
    }

    if (options.pipeline) args.push("--pipeline", String(options.pipeline));
    if (options.vlmModel) args.push("--vlm-model", String(options.vlmModel));
    if (options.asrModel) args.push("--asr-model", String(options.asrModel));

    if (options.ocr !== undefined) args.push(options.ocr ? "--ocr" : "--no-ocr");
    if (options.forceOcr) args.push("--force-ocr");
    if (options.ocrEngine) args.push("--ocr-engine", String(options.ocrEngine));
    if (options.ocrLang?.length) {
      args.push("--ocr-lang", options.ocrLang.join(","));
    }

    if (options.pdfBackend) args.push("--pdf-backend", String(options.pdfBackend));

    if (options.tableMode) args.push("--table-mode", String(options.tableMode));

    if (options.imageExportMode) args.push("--image-export-mode", String(options.imageExportMode));
    if (options.showLayout) args.push("--show-layout");

    if (options.enrichCode) args.push("--enrich-code");
    if (options.enrichFormula) args.push("--enrich-formula");
    if (options.enrichPictureClasses) args.push("--enrich-picture-classes");
    if (options.enrichPictureDescriptions) args.push("--enrich-picture-description");
    if (typeof options.pictureDescriptionAreaThreshold === "number") {
      args.push(
        "--picture-description-area-threshold",
        String(options.pictureDescriptionAreaThreshold)
      );
    }

    if (options.abortOnError) args.push("--abort-on-error");
    if (typeof options.documentTimeout === "number") {
      args.push("--document-timeout", String(options.documentTimeout));
    }
    if (typeof options.numThreads === "number") {
      args.push("--num-threads", String(options.numThreads));
    }
    if (options.device) args.push("--device", String(options.device));

    if (options.artifactsPath) args.push("--artifacts-path", resolve(options.artifactsPath));
    if (options.enableRemoteServices) args.push("--enable-remote-services");
    if (options.allowExternalPlugins) args.push("--allow-external-plugins");
    if (options.showExternalPlugins) args.push("--show-external-plugins");

    if (options.debugVisualizeCells) args.push("--debug-visualize-cells");
    if (options.debugVisualizeOcr) args.push("--debug-visualize-ocr");
    if (options.debugVisualizeLayout) args.push("--debug-visualize-layout");
    if (options.debugVisualizeTables) args.push("--debug-visualize-tables");

    if (options.headers) args.push("--headers", String(options.headers));

    if (typeof options.verbose === "number") {
      if (!Number.isSafeInteger(options.verbose) || options.verbose < 0 || options.verbose > 3) {
        throw new RangeError("Verbose level must be an integer between 0 and 3");
      }
      args.push(...Array<string>(options.verbose).fill("--verbose"));
    }

    if (options.sources && options.sources.length > 0) {
      args.push(...options.sources.map(String));
    }

    return args;
  }

  /**
   * Process a single file for batch conversion
   */
  private async processSingleFile(
    file: { filename: string; buffer?: Buffer; filePath?: string },
    index: number,
    totalFiles: number,
    options: ConversionOptions,
    onProgress?: (progress: {
      stage: string;
      currentFile: number;
      totalFiles: number;
      filename: string;
      percentage: number;
    }) => void
  ): Promise<{
    filename: string;
    success: boolean;
    result?: ConvertDocumentResponse;
    error?: string;
  }> {
    if (!file) {
      return {
        filename: "unknown",
        success: false,
        error: "File is null or undefined",
      };
    }

    const percentage = Math.round(((index + 1) / totalFiles) * 100);

    if (onProgress) {
      onProgress({
        stage: "processing",
        currentFile: index + 1,
        totalFiles,
        filename: file.filename,
        percentage,
      });
    }

    try {
      const result = await this.convertSingleFileByType(file, options);

      return {
        filename: file.filename,
        success: result.status === "success",
        result,
      };
    } catch (error) {
      if (error instanceof ProcessAbortError) throw error;
      return {
        filename: file.filename,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Convert single file based on type (buffer or file path)
   */
  private async convertSingleFileByType(
    file: { filename: string; buffer?: Buffer; filePath?: string },
    options: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    if (file.buffer) {
      return await this.convertFromBuffer(file.buffer, file.filename, options);
    }
    if (file.filePath) {
      return await this.convertFromFile(file.filePath, options);
    }
    throw new Error("Either buffer or filePath must be provided");
  }

  /** Each request owns its input snapshot and format output directories. */
  private async createJob(outputRoot = this.outputDir): Promise<ConversionJob> {
    await mkdir(resolve(outputRoot), { recursive: true });
    const root = await realpath(resolve(outputRoot));
    this.jobRoots.add(root);
    return {
      directory: await mkdtemp(join(root, "docling-job-")),
      outputs: [],
      errors: [],
      status: "failure",
      stdout: "",
      stderr: "",
      exitCode: 0,
      started: Date.now(),
    };
  }

  private validateFilename(filename: string): void {
    if (!filename || filename === "." || filename === ".." || /[\\/\0]/.test(filename)) {
      throw new Error("Filename must be a single path component");
    }
  }

  /** The root itself may contain caller inputs; only its job namespaces are owned. */
  private isJobPath(path: string, outputRoot: string): boolean {
    // chokidar's synchronous ignore predicate can receive symlink-alias paths.
    const canonical = (value: string) => {
      try {
        return realpathSync(value);
      } catch {
        return resolve(value);
      }
    };
    const candidate = canonical(path);
    for (const root of [canonical(outputRoot), ...this.jobRoots]) {
      const first = relative(root, candidate).split(sep)[0];
      if (first && /^docling-job-[A-Za-z0-9]{6}$/.test(first)) return true;
    }
    return false;
  }

  private async expandCliSources(
    options: CliConvertOptions,
    outputRoot: string,
    signal?: AbortSignal
  ): Promise<string[]> {
    // Docling 2.60.1's CLI discovers these extensions recursively for directory inputs.
    const extensions: Record<InputFormat, string[]> = {
      docx: ["docx", "dotx", "docm", "dotm"],
      pptx: ["pptx", "potx", "ppsx", "pptm", "potm", "ppsm"],
      pdf: ["pdf"],
      md: ["md"],
      html: ["html", "htm", "xhtml"],
      xml_jats: ["xml", "nxml"],
      image: ["jpg", "jpeg", "png", "tif", "tiff", "bmp", "webp"],
      asciidoc: ["adoc", "asciidoc", "asc"],
      csv: ["csv"],
      xlsx: ["xlsx", "xlsm"],
      xml_uspto: ["xml", "txt"],
      json_docling: ["json"],
      audio: ["wav", "mp3", "m4a", "aac", "ogg", "flac", "mp4", "avi", "mov"],
    };
    const allowed = new Set(
      options.fromFormats?.length
        ? options.fromFormats.flatMap((format) => extensions[format])
        : Object.values(extensions).flat()
    );
    const sources: string[] = [];
    const seen = new Set<string>();
    const within = (path: string, root: string) =>
      path === root || path.startsWith(`${root}${sep}`);
    for (const source of options.sources) {
      if (signal?.aborted) throw new ProcessAbortError();
      if (/^https?:\/\//i.test(source)) {
        sources.push(source);
        continue;
      }
      const canonical = await realpath(source);
      if (!(await stat(canonical)).isDirectory()) {
        sources.push(source);
        continue;
      }
      const walk = async (directory: string): Promise<void> => {
        if (signal?.aborted) throw new ProcessAbortError();
        if (
          seen.has(directory) ||
          this.isJobPath(directory, outputRoot) ||
          (outputRoot !== canonical &&
            within(outputRoot, canonical) &&
            within(directory, outputRoot))
        )
          return;
        seen.add(directory);
        const entries = await readdir(directory, { withFileTypes: true });
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
          const path = join(directory, entry.name);
          // Do not follow directory aliases into cycles or the output tree.
          if (entry.isDirectory()) await walk(path);
          else if (
            entry.isFile() &&
            allowed.has(extname(entry.name).slice(1).toLowerCase()) &&
            !(entry.name.startsWith("~$") && extname(entry.name).toLowerCase() === ".docx")
          )
            sources.push(path);
        }
      };
      await walk(canonical);
    }
    return sources;
  }

  private async snapshotInput(
    job: ConversionJob,
    file: Buffer | string,
    filename: string,
    index: number
  ): Promise<string> {
    this.validateFilename(filename);
    const inputDirectory = join(job.directory, `input-${index}`);
    await mkdir(inputDirectory);
    const inputPath = join(inputDirectory, filename);
    if (typeof file === "string") await copyFile(resolve(file), inputPath, constants.COPYFILE_EXCL);
    else await writeFile(inputPath, file, { flag: "wx" });
    return inputPath;
  }

  private async runDocumentJob(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions,
    outputRoot = this.outputDir
  ): Promise<ConversionJob> {
    const validated = this.prepareOptions(options);
    const formats = [...new Set(validated.to_formats ?? ["text" as const])];
    if (formats.length === 0) throw new Error("At least one output format is required");
    this.validateFilename(filename);
    const job = await this.createJob(outputRoot);
    try {
      const input = await this.snapshotInput(job, file, filename, 0);
      this.progress.emit("processing-start", {
        file: filename,
        inputPath: input,
        jobId: basename(job.directory),
      });
      this.progress.emit("multi-format-start", {
        file: filename,
        formats,
        totalFormats: formats.length,
      });
      this.emitJobProgress(job, "start", filename, "Initializing processing", 0, formats.length);
      for (const [index, format] of formats.entries()) {
        await this.runFormat(job, filename, format, index, formats.length, (output) =>
          this.buildDoclingArgs(input, output, { ...validated, to_formats: [format] })
        );
      }
      this.finishJob(job, filename, formats.length);
      return job;
    } catch (error) {
      await this.cleanupTempDirectory(job.directory);
      this.progress.emit("processing-error", {
        file: filename,
        error: error instanceof Error ? error.message : String(error),
        jobId: basename(job.directory),
      });
      throw error;
    } finally {
      await this.cleanupTempDirectory(join(job.directory, "input-0"));
    }
  }

  private async runCliJob(
    options: CliConvertOptions,
    onStderr?: (data: string) => void,
    signal?: AbortSignal
  ): Promise<ConversionJob> {
    if (signal?.aborted) throw new ProcessAbortError();
    const formats = [...new Set(options.toFormats ?? ["md" as const])];
    this.validateConfiguration({ to_formats: formats });
    if (formats.length === 0 || options.sources.length === 0)
      throw new Error("Sources and output formats are required");
    const job = await this.createJob(options.output || this.outputDir);
    let inputCount = 0;
    try {
      const sources = await this.expandCliSources(options, dirname(job.directory), signal);
      if (sources.length === 0) throw new Error("No supported files found in sources");
      this.emitJobProgress(
        job,
        "start",
        options.sources.join(", "),
        "Initializing processing",
        0,
        formats.length * sources.length
      );
      let index = 0;
      const downloads = new Map<string, { filename: string; path: string }>();
      for (const source of sources) {
        if (signal?.aborted) throw new ProcessAbortError();
        const sourceIndex = inputCount++;
        const isUrl = /^https?:\/\//i.test(source);
        let filename = basename(source);
        let input: string;
        if (isUrl) {
          let downloaded = downloads.get(source);
          if (!downloaded) {
            const inputDirectory = join(job.directory, `input-${sourceIndex}`);
            await mkdir(inputDirectory);
            downloaded = await this.downloadFile(this.resolveRemoteSource(source), inputDirectory, {
              signal,
              headers: options.headers,
            });
            downloads.set(source, downloaded);
            this.progress.emit("url-downloaded", { url: source, tempFilePath: downloaded.path });
          }
          filename = downloaded.filename;
          input = downloaded.path;
        } else input = await this.snapshotInput(job, source, filename, sourceIndex);
        for (const format of formats) {
          if (signal?.aborted) throw new ProcessAbortError();
          await this.runFormat(
            job,
            filename,
            format,
            index++,
            formats.length * sources.length,
            (output) =>
              this.buildCliArgs({ ...options, sources: [input], toFormats: [format], output }),
            onStderr,
            signal
          );
        }
      }
      this.finishJob(job, options.sources.join(", "), formats.length * sources.length);
      return job;
    } catch (error) {
      await this.cleanupTempDirectory(job.directory);
      throw error;
    } finally {
      for (let index = 0; index < inputCount; index++)
        await this.cleanupTempDirectory(join(job.directory, `input-${index}`));
    }
  }

  private async runFormat(
    job: ConversionJob,
    filename: string,
    format: OutputFormat,
    index: number,
    total: number,
    buildArgs: (output: string) => string[],
    onStderr?: (data: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const outputDirectory = join(job.directory, `format-${index}`);
    await mkdir(outputDirectory);
    const args = buildArgs(outputDirectory);
    const event = {
      file: filename,
      format,
      progress: index + 1,
      total,
      jobId: basename(job.directory),
    };
    this.progress.emit("format-processing-start", event);
    this.emitJobProgress(
      job,
      "progress",
      filename,
      `Processing format ${format}`,
      index,
      total,
      format
    );
    this.progress.emit("command-built", {
      command: [this.doclingCommand, ...this.commandPrefix, ...args].join(" "),
      executable: this.doclingCommand,
      args: [...this.commandPrefix, ...args],
      format,
    });
    let processCompleted = false;
    try {
      const result = await this.runCommand(args, { cwd: job.directory, onStderr, signal });
      processCompleted = true;
      job.stdout += result.stdout;
      job.stderr += result.stderr;
      if (!result.success) {
        job.exitCode = result.exitCode ?? -1;
        throw this.processError(result);
      }
      const upstream = this.upstreamResult(result.stdout);
      if (upstream.status === "failure" || upstream.status === "skipped") {
        job.errors.push(...upstream.errors);
        throw new Error(`Upstream conversion status: ${upstream.status}`);
      }
      const output = await this.readExpectedOutput(outputDirectory, filename, format);
      const exported = format === "json" ? this.upstreamResult(output.content) : { errors: [] };
      if (exported.status === "failure" || exported.status === "skipped") {
        job.errors.push(...exported.errors);
        throw new Error(`Exported conversion status: ${exported.status}`);
      }
      const errors = [...upstream.errors, ...exported.errors];
      const partial =
        upstream.status === "partial_success" ||
        exported.status === "partial_success" ||
        errors.length > 0;
      job.outputs.push(output);
      this.progress.emit("file-read", {
        format,
        path: output.path,
        size: Buffer.byteLength(output.content),
      });
      if (partial) {
        job.status = "partial_success";
        const warnings = errors.length
          ? errors
          : [
              {
                message: `Upstream reported partial_success for ${format}`,
                code: "CLI_PARTIAL_SUCCESS",
              },
            ];
        job.errors.push(...warnings);
        this.progress.emit("processing-warning", {
          ...event,
          status: "partial_success",
          errors: warnings,
        });
      }
      this.progress.emit("format-processing-complete", {
        ...event,
        success: !partial,
        status: partial ? "partial_success" : "success",
        outputFiles: { [format]: output.path },
      });
      this.emitJobProgress(
        job,
        "progress",
        filename,
        `Completed format ${format}`,
        index + 1,
        total,
        format
      );
    } catch (error) {
      if (!processCompleted) job.exitCode = -1;
      job.outputs = job.outputs.filter((output) => dirname(output.path) !== outputDirectory);
      const message = error instanceof Error ? error.message : String(error);
      job.errors.push({
        message: `${format}: ${message}`,
        code: "CLI_FORMAT_FAILED",
        details: { format, filename, ...(error instanceof Error && { name: error.name }) },
      });
      this.progress.emit("format-processing-error", { ...event, error: message, retryable: false });
      this.emitJobProgress(
        job,
        "progress",
        filename,
        `Failed format ${format}`,
        index + 1,
        total,
        format
      );
      await this.cleanupTempDirectory(outputDirectory);
      // Cancellation ends the job; ordinary format failures can still aggregate.
      if (error instanceof ProcessAbortError) throw error;
    }
  }

  private finishJob(job: ConversionJob, filename: string, requested: number): void {
    job.status =
      job.outputs.length === 0
        ? "failure"
        : job.outputs.length < requested || job.status === "partial_success"
          ? "partial_success"
          : "success";
    if (job.status !== "success") {
      this.progress.emit("conversion-partial-failure", {
        file: filename,
        status: job.status,
        successful: job.outputs.length,
        failed: requested - job.outputs.length,
        errors: job.errors,
        failedFormats: job.errors.flatMap((error) => {
          const details = error.details;
          return error.code === "CLI_FORMAT_FAILED" &&
            details &&
            typeof details === "object" &&
            "format" in details &&
            typeof details.format === "string"
            ? [details.format]
            : [];
        }),
      });
    }
    const outputFiles = Object.fromEntries(
      job.outputs.map((output, index) => [
        job.outputs.filter((candidate) => candidate.format === output.format).length > 1
          ? `${index}:${output.format}`
          : output.format,
        output.path,
      ])
    );
    this.progress.emit("multi-format-complete", {
      file: filename,
      jobId: basename(job.directory),
      success: job.status === "success",
      status: job.status,
      totalFormats: requested,
      processedFormats: job.outputs.length,
      outputFiles,
    });
    this.emitJobProgress(
      job,
      job.status === "success" ? "complete" : "error",
      filename,
      `Conversion ${job.status}`,
      requested,
      requested
    );
  }

  private emitJobProgress(
    job: ConversionJob,
    type: "start" | "progress" | "complete" | "error",
    filename: string,
    step: string,
    attempted: number,
    total: number,
    format?: string
  ): void {
    this.progress.emit("enhanced-progress", {
      type,
      file: filename,
      ...(format && { format }),
      jobId: basename(job.directory),
      percentage: total ? Math.round((attempted / total) * 10000) / 100 : 0,
      currentStep: step,
      filesCompleted: type === "complete" || type === "error" ? 1 : 0,
      totalFiles: 1,
      formatsCompleted: job.outputs.length,
      totalFormats: total,
      processingTime: Date.now() - job.started,
    });
  }

  private upstreamResult(stdout: string): { status?: ConversionStatus; errors: ProcessingError[] } {
    try {
      const value: unknown = JSON.parse(stdout);
      if (!value || typeof value !== "object" || Array.isArray(value)) return { errors: [] };
      const result = value as Record<string, unknown>;
      const status = result.status;
      const errors = Array.isArray(result.errors)
        ? result.errors.filter(
            (error): error is ProcessingError =>
              !!error && typeof error === "object" && typeof error.message === "string"
          )
        : [];
      return {
        ...(["success", "partial_success", "failure", "skipped"].includes(String(status)) && {
          status: status as ConversionStatus,
        }),
        errors,
      };
    } catch {
      return { errors: [] };
    }
  }

  private async readExpectedOutput(
    directory: string,
    filename: string,
    format: OutputFormat
  ): Promise<ValidatedOutput> {
    const extension = DoclingCLIClient.FORMAT_TO_EXTENSION_MAP.get(format);
    if (!extension) throw new Error(`Unsupported output format: ${format}`);
    const name = `${basename(filename, extname(filename))}.${extension}`;
    const path = join(directory, name);
    try {
      const parent = await lstat(directory);
      if (parent.isSymbolicLink() || !parent.isDirectory())
        throw new Error("Unsafe output directory");
      const canonical = await realpath(directory);
      if (canonical !== resolve(directory)) throw new Error("Output directory escaped its job");
      const content = (await this.readOwnedOutputFile(path)).toString("utf-8");
      let value: ValidatedOutput["value"] = content;
      if (format === "json") {
        const parsed: unknown = JSON.parse(content);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          typeof (parsed as Record<string, unknown>).name !== "string"
        ) {
          throw new Error("JSON output must be a Docling document object with a name");
        }
        const document = parsed as Record<string, unknown>;
        for (const key of ["schema_name", "schema_version", "version", "description"]) {
          if (document[key] !== undefined && typeof document[key] !== "string")
            throw new Error(`Invalid JSON document field: ${key}`);
        }
        for (const key of [
          "logs",
          "main_text",
          "tables",
          "pictures",
          "page_dimensions",
          "page_footers",
          "page_headers",
          "footnotes",
          "captions",
          "texts",
          "groups",
          "key_value_items",
          "form_items",
        ]) {
          if (document[key] !== undefined && !Array.isArray(document[key]))
            throw new Error(`Invalid JSON document field: ${key}`);
        }
        value = parsed as NonNullable<ExportDocumentResponse["json_content"]>;
      } else if (
        (format === "html" || format === "html_split_page") &&
        !/<[a-z][^>]*>/i.test(content)
      ) {
        throw new Error("HTML output must contain document markup");
      }
      // Empty text/Markdown are valid exports for an empty document; file presence still matters.
      const assets = await this.readOutputAssets(
        directory,
        `${basename(filename, extname(filename))}_artifacts`
      );
      return { format, path, name, content, value, assets };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        this.progress.emit("file-not-found", { format, expectedPath: path, triedPaths: [path] });
      else
        this.progress.emit("parse-error", {
          format,
          error: error instanceof Error ? error.message : String(error),
        });
      throw error;
    }
  }

  /** Read a job-owned regular file without following replaced paths or hard links. */
  private async readOwnedOutputFile(path: string): Promise<Buffer> {
    const parent = dirname(resolve(path));
    if ((await realpath(parent)) !== parent) throw new Error("Output directory escaped its job");
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1)
      throw new Error("Expected a regular output file, refusing symlink or hard link");
    if (!(await realpath(path)).startsWith(`${parent}${sep}`))
      throw new Error("Output escaped its job");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.dev !== info.dev ||
        opened.ino !== info.ino
      )
        throw new Error("Output file changed during validation");
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  /** Only the converter's exact per-document artifact namespace belongs to this output. */
  private async readOutputAssets(
    directory: string,
    name: string
  ): Promise<ValidatedOutput["assets"]> {
    const root = join(directory, name);
    let info: Stats;
    try {
      info = await lstat(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== resolve(root))
      throw new Error("Unsafe output artifact directory");
    const assets: ValidatedOutput["assets"] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const assetName = `${name}/${entry.name}`;
      if (entry.isDirectory()) assets.push(...(await this.readOutputAssets(directory, assetName)));
      else {
        const path = join(directory, assetName);
        assets.push({ path, name: assetName, bytes: await this.readOwnedOutputFile(path) });
      }
    }
    return assets;
  }

  private documentResponse(job: ConversionJob, filename: string): ConvertDocumentResponse {
    const document: ExportDocumentResponse = { filename };
    for (const output of job.outputs) {
      const key = DoclingCLIClient.FORMAT_TO_CONTENT_KEY_MAP.get(output.format);
      if (key) Object.assign(document, { [key]: output.value });
    }
    return {
      document,
      status: job.status,
      processing_time: Date.now() - job.started,
      ...(job.errors.length && { errors: job.errors }),
    };
  }

  private cliJobResult(job: ConversionJob): CliConversionResult {
    const outputs: NonNullable<CliConversionResult["outputs"]> = {};
    for (const output of job.outputs) {
      const key =
        output.format === "md"
          ? "markdown"
          : output.format === "html_split_page"
            ? "html"
            : output.format;
      outputs[key] = (outputs[key] ?? "") + output.content;
    }
    return {
      success: job.status === "success",
      stdout: job.stdout,
      stderr: job.stderr,
      exitCode: job.exitCode,
      outputs,
      outputFiles: job.outputs.flatMap((output) => [
        output.path,
        ...output.assets.map((asset) => asset.path),
      ]),
      ...(job.status !== "success" && {
        error: new Error(
          job.errors.map((error) => error.message).join("; ") || `Conversion ${job.status}`
        ),
      }),
    };
  }

  private async processFile(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions,
    outputRoot = this.outputDir
  ): Promise<ConvertDocumentResponse> {
    await this.ensureInitialized();
    const job = await this.runDocumentJob(file, filename, options, outputRoot);
    if (job.outputs.length === 0) await this.cleanupTempDirectory(job.directory);
    return this.documentResponse(job, filename);
  }

  /**
   * Argument builders map
   */
  private readonly argBuilders = new Map<string, ArgumentBuilderFunction>([
    [
      "to_formats",
      (formats: unknown) => {
        if (!Array.isArray(formats) || formats.length === 0) return [];
        const firstFormat = String(formats[0]);
        return ["--to", firstFormat];
      },
    ],
    [
      "toFormats",
      (formats: unknown) => {
        if (!Array.isArray(formats) || formats.length === 0) return [];
        const firstFormat = String(formats[0]);
        return ["--to", firstFormat];
      },
    ],

    ["pdf_backend", (backend: unknown) => ["--pdf-backend", String(backend)]],

    ["do_ocr", (enable: unknown) => (enable !== false ? ["--ocr"] : ["--no-ocr"])],
    ["ocr_engine", (engine: unknown) => ["--ocr-engine", String(engine)]],
    [
      "ocr_lang",
      (langs: unknown) => {
        if (!Array.isArray(langs) || langs.length === 0) return [];
        return ["--ocr-lang", langs.join(",")];
      },
    ],
    ["force_ocr", (enable: unknown) => (enable ? ["--force-ocr"] : [])],
    ["ocr_confidence", (conf: unknown) => ["--ocr-confidence", String(conf)]],

    [
      "from_formats",
      (formats: unknown) => {
        if (!Array.isArray(formats) || formats.length === 0) return [];
        return formats.flatMap((format) => ["--from", String(format)]);
      },
    ],

    ["table_mode", (mode: unknown) => ["--table-mode", String(mode)]],
    ["do_table_structure", (enable: unknown) => [enable ? "--tables" : "--no-tables"]],
    ["table_batch_size", (size: unknown) => ["--table-batch-size", String(size)]],

    ["do_code_enrichment", (enable: unknown) => (enable ? ["--enrich-code"] : [])],
    ["do_formula_enrichment", (enable: unknown) => (enable ? ["--enrich-formula"] : [])],
    [
      "do_picture_classification",
      (enable: unknown) => (enable ? ["--enrich-picture-classes"] : []),
    ],
    [
      "do_picture_description",
      (enable: unknown) => (enable ? ["--enrich-picture-description"] : []),
    ],

    ["pipeline", (pipeline: unknown) => ["--pipeline", String(pipeline)]],
    ["processing_pipeline", (pipeline: unknown) => ["--pipeline", String(pipeline)]],
    [
      "abort_on_error",
      (enable: unknown) => (enable ? ["--abort-on-error"] : ["--no-abort-on-error"]),
    ],
    ["document_timeout", (timeout: unknown) => ["--document-timeout", String(timeout)]],
    ["num_threads", (threads: unknown) => ["--num-threads", String(threads)]],
    ["device", (device: unknown) => ["--device", String(device)]],

    ["artifacts_path", (path: unknown) => ["--artifacts-path", resolve(String(path))]],
    ["allow_external_plugins", (enable: unknown) => (enable ? ["--allow-external-plugins"] : [])],

    ["images_scale", (scale: unknown) => ["--images-scale", String(scale)]],
    ["image_export_mode", (mode: unknown) => ["--image-export-mode", String(mode)]],

    ["debug_visualize_cells", (enable: unknown) => (enable ? ["--debug-visualize-cells"] : [])],
    ["debug_visualize_ocr", (enable: unknown) => (enable ? ["--debug-visualize-ocr"] : [])],
    ["debug_visualize_layout", (enable: unknown) => (enable ? ["--debug-visualize-layout"] : [])],
    ["debug_visualize_tables", (enable: unknown) => (enable ? ["--debug-visualize-tables"] : [])],

    ["export_json", (enable: unknown) => (enable ? ["--export-json"] : [])],
    ["export_html", (enable: unknown) => (enable ? ["--export-html"] : [])],
    ["export_html_split_page", (enable: unknown) => (enable ? ["--export-html-split-page"] : [])],
    ["export_md", (enable: unknown) => (enable ? ["--export-md"] : [])],
    ["export_txt", (enable: unknown) => (enable ? ["--export-txt"] : [])],
    ["export_doctags", (enable: unknown) => (enable ? ["--export-doctags"] : [])],
    ["show_layout", (enable: unknown) => (enable ? ["--show-layout"] : [])],

    ["headers", (headers: unknown) => ["--headers", String(headers)]],

    [
      "page_range",
      (range: unknown) => {
        if (Array.isArray(range) && range.length === 2) {
          return ["--pages", `${range[0]}-${range[1]}`];
        }
        return ["--pages", String(range)];
      },
    ],
    ["pages", (pages: unknown) => ["--pages", String(pages)]],

    ["ocr_batch_size", (size: unknown) => ["--ocr-batch-size", String(size)]],
    ["layout_batch_size", (size: unknown) => ["--layout-batch-size", String(size)]],
    ["page_batch_size", (size: unknown) => ["--page-batch-size", String(size)]],
    ["batch_timeout_seconds", (timeout: unknown) => ["--batch-timeout", String(timeout)]],
    ["queue_max_size", (size: unknown) => ["--queue-max-size", String(size)]],

    [
      "verbose",
      (level: unknown) => {
        if (typeof level === "number" && level > 1) {
          return Array(level).fill("--verbose").flat();
        }
        return level ? ["--verbose"] : [];
      },
    ],
    ["quiet", (enable: unknown) => (enable ? ["--quiet"] : [])],

    ["create_legacy_output", (enable: unknown) => (enable ? ["--create-legacy-output"] : [])],
    ["enable_remote_services", (enable: unknown) => (enable ? ["--enable-remote-services"] : [])],

    ["vlm_model", (model: unknown) => ["--vlm-model", String(model)]],
    ["asr_model", (model: unknown) => ["--asr-model", String(model)]],

    ["include_images", (enable: unknown) => (enable ? ["--include-images"] : [])],

    ["show_external_plugins", (enable: unknown) => (enable ? ["--show-external-plugins"] : [])],

    ["logo", (enable: unknown) => (enable ? ["--logo"] : [])],
  ]);

  /** Arguments remain literal values from construction through process execution. */
  private buildDoclingArgs(
    inputPath: string,
    outputDirectory: string,
    options?: ConversionOptions
  ): string[] {
    const optionArgs = Object.entries(options || {})
      .filter(([_, value]) => value !== undefined && value !== null)
      .flatMap(([key, value]) => this.argBuilders.get(key)?.(value) || []);
    return [
      inputPath,
      "--output",
      outputDirectory,
      ...optionArgs,
      ...(this.config.verbose ? ["--verbose"] : []),
    ];
  }

  private processError(result: ProcessRunResult): Error {
    return Object.assign(
      new Error(
        `Docling CLI exited with code ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}. stderr: ${result.stderr}`
      ),
      {
        exitCode: result.exitCode ?? -1,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    );
  }

  private async runCommand(
    args: string[],
    options: ProcessRunOptions = {}
  ): Promise<ProcessRunResult> {
    return runProcess(this.doclingCommand, [...this.commandPrefix, ...args], {
      timeout: this.config.timeout ?? 300000,
      maxBuffer: 10 * 1024 * 1024,
      ...options,
      onStdout: (data) => {
        this.progress.emit("stdout", { data });
        options.onStdout?.(data);
      },
      onStderr: (data) => {
        this.progress.emit("stderr", { data });
        options.onStderr?.(data);
      },
    });
  }

  /** Public compatibility adapter; each argument is passed literally, without a shell. */
  async executeCommand(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await this.runCommand(args);
    if (!result.success) throw this.processError(result);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? -1 };
  }

  /**
   * Clean up resources and listeners
   */
  destroy(): void {
    for (const stop of this.watchStops) stop();
    this.progress.removeAllListeners();
  }

  /**
   * Check if file should be processed based on patterns
   */
  private shouldProcessFile(filePath: string, patterns: string[]): boolean {
    const normalized = filePath.replace(/\\/g, "/");
    return patterns.some((pattern) => {
      const expression = pattern
        .replace(/\\/g, "/")
        .split(/(\*\*\/|\*\*|\*)/)
        .map((part) => {
          if (part === "**/") return "(?:.*/)?";
          if (part === "**") return ".*";
          if (part === "*") return "[^/]*";
          return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
      const matcher = new RegExp(`^${expression}$`);
      return matcher.test(normalized) || matcher.test(basename(normalized));
    });
  }

  /**
   * Convert stream to buffer
   */
  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      stream.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      stream.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      stream.on("error", (error) => {
        reject(error);
      });
    });
  }

  /** Archive the exact validated bytes belonging to this request. */
  private async createZipFromOutputs(outputs: ValidatedOutput[]): Promise<Buffer> {
    const { zip } = await import("fflate");
    const entries: Record<string, Uint8Array> = Object.create(null);
    for (const [index, output] of outputs.entries()) {
      const duplicate = outputs.some(
        (candidate, otherIndex) => otherIndex !== index && candidate.name === output.name
      );
      const prefix = duplicate ? `${index}/` : "";
      let content = output.content;
      if (output.format === "json" && output.assets.length > 0) {
        const relocated = new Map(
          output.assets.map((asset) => [asset.path, `${output.name}.assets/${asset.name}`])
        );
        // Decode JSON escapes before comparing exact URI values. Parse a fresh
        // object so the original structured result and unrelated fields stay intact.
        content = JSON.stringify(
          JSON.parse(content, (key, value: unknown) =>
            key === "uri" && typeof value === "string" ? (relocated.get(value) ?? value) : value
          )
        );
      }
      for (const asset of output.assets) {
        const relativeName = `${output.name}.assets/${asset.name}`;
        if (output.format !== "json") {
          // Match Python's URI quoting, including reserved characters and spaces.
          const quotePath = (path: string) =>
            encodeURIComponent(path)
              .replaceAll("%2F", "/")
              .replace(
                /[!'()*]/g,
                (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
              );
          const relativeUri = quotePath(relativeName);
          content = content
            .replaceAll(asset.path, () => relativeUri)
            .replaceAll(encodeURI(asset.path), () => relativeUri)
            .replaceAll(quotePath(asset.path), () => relativeUri);
        }
        entries[`${prefix}${relativeName}`] = asset.bytes;
      }
      entries[`${prefix}${output.name}`] = Buffer.from(content);
    }
    return new Promise((resolveZip, reject) => {
      zip(entries, { level: 9 }, (error, bytes) => {
        if (error) reject(error);
        else resolveZip(Buffer.from(bytes));
      });
    });
  }

  private async createTempDirectory(): Promise<string> {
    // macOS commonly exposes its temporary directory through a symlink.
    return mkdtemp(join(await realpath(tmpdir()), "docling-cli-"));
  }

  /**
   * Clean up temporary directory
   */
  private async cleanupTempDirectory(tempDir: string): Promise<void> {
    try {
      // Never follow a replaced ancestor when removing a job's snapshots/artifacts.
      const parent = dirname(resolve(tempDir));
      if ((await realpath(parent)) !== parent)
        throw new Error("Refusing cleanup through a symlink ancestor");
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.progress.emit("cleanup-warning", { path: tempDir, error });
    }
  }

  /**
   * Extract filename from URL
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = decodeURIComponent(basename(pathname));

      if (!filename) {
        const hostname = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, "_");
        return `${hostname}_document.pdf`;
      }

      this.validateFilename(filename);
      if (
        filename.includes(":") ||
        [...filename].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        )
      )
        throw new Error("Unsafe remote filename");
      return filename;
    } catch {
      // Ignore errors
      // Return fallback filename if URL parsing fails
      return "document.pdf";
    }
  }

  private remoteFilename(url: string, disposition: string | null): string {
    const safe = (name: string | undefined): string | undefined => {
      if (
        !name ||
        name === "." ||
        name === ".." ||
        /[\\/:]/.test(name) ||
        [...name].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        )
      )
        return undefined;
      return name;
    };
    // Prefer RFC 5987 UTF-8 filenames, then the ordinary quoted/token parameter.
    const extended = disposition?.match(/(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]*)/i)?.[1];
    if (extended) {
      try {
        const filename = safe(decodeURIComponent(extended.trim()));
        if (filename) return filename;
      } catch {
        /* Fall back to the ordinary parameter or URL. */
      }
    }
    const parameter = disposition?.match(
      /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^;]*))/i
    );
    const filename = safe(
      parameter?.[1]?.replace(/\\(["\\])/g, (_match, value: string) => value) ??
        parameter?.[2] ??
        parameter?.[3]?.trim()
    );
    return filename ?? this.extractFilenameFromUrl(url);
  }

  private resolveRemoteSource(source: string): string {
    // Preserve Python Docling Core 2.60.1's public Google export link support.
    const url = new URL(source);
    if (url.hostname !== "docs.google.com" && url.hostname !== "drive.google.com") return source;
    const match = url.pathname.match(
      /^\/(file|document|spreadsheets|presentation)\/d\/([\w-]+)(?:\/|$)/
    );
    if (!match) return source;
    const [, kind, id] = match;
    if (kind === "file") return `https://drive.google.com/uc?export=download&id=${id}`;
    const format = kind === "document" ? "docx" : kind === "spreadsheets" ? "xlsx" : "pptx";
    return `https://docs.google.com/${kind}/d/${id}/export?format=${format}`;
  }

  /** One bounded request/body transfer into an owned directory, shared across formats. */
  private async downloadFile(
    url: string,
    directory: string,
    options: { signal?: AbortSignal; headers?: string } = {}
  ): Promise<{ filename: string; path: string }> {
    const timeout = this.config.timeout ?? 300000;
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2 ** 31 - 1)
      throw new RangeError("timeout must be between 0 and 2147483647 milliseconds");
    if (options.signal?.aborted) throw new ProcessAbortError();
    let headers: Record<string, string> | undefined;
    if (options.headers !== undefined) {
      const parsed: unknown = JSON.parse(options.headers);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.values(parsed).some((value) => typeof value !== "string")
      )
        throw new Error("CLI headers must be a JSON object of string values");
      headers = parsed as Record<string, string>;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(new ProcessAbortError());
    options.signal?.addEventListener("abort", onAbort, { once: true });
    process.on("SIGINT", onAbort);
    process.on("SIGTERM", onAbort);
    const timer =
      timeout > 0
        ? setTimeout(() => controller.abort(new ProcessTimeoutError(timeout)), timeout)
        : undefined;
    let response: Response | undefined;
    let outputPath: string | undefined;
    let outputCreated = false;
    try {
      response = await fetch(url, { signal: controller.signal, headers });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const filename = this.remoteFilename(url, response.headers.get("content-disposition"));
      outputPath = join(directory, filename);
      const source = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream<Uint8Array>
      );
      const destination = createWriteStream(outputPath, { flags: "wx" });
      destination.once("open", () => {
        outputCreated = true;
      });
      // fromWeb owns reader cancellation if writing fails; the same signal bounds
      // both response headers and a stalled body. Never overwrite an existing file.
      await pipeline(source, destination, { signal: controller.signal });
      return { filename, path: outputPath };
    } catch (error) {
      controller.abort(error);
      if (response?.body && !response.body.locked)
        await response.body.cancel().catch(() => undefined);
      if (outputPath && outputCreated) await this.cleanupTempDirectory(outputPath);
      if (
        controller.signal.reason instanceof ProcessAbortError ||
        controller.signal.reason instanceof ProcessTimeoutError
      )
        throw controller.signal.reason;
      throw new Error(
        `Failed to download file from ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      process.off("SIGINT", onAbort);
      process.off("SIGTERM", onAbort);
    }
  }
}
