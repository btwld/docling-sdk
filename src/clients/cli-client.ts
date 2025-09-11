import { type ChildProcess, exec, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, watch as fsWatch } from "node:fs";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { promisify } from "node:util";
import archiver from "archiver";
import { watch as chokidarWatch } from "chokidar";
import type {
  ConversionFileResult,
  ConversionOptions,
  ConversionResult,
  OutputFormat,
} from "../types/api";
import type { CliConversionResult, CliConvertOptions } from "../types/cli";

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

const execAsync = promisify(exec);

/**
 * Argument builder function type
 */
type ArgumentBuilderFunction = (value: unknown) => string[];

/**
 * Error types for categorization and retry logic
 */
enum ErrorType {
  TRANSIENT = "transient",
  PERMANENT = "permanent",
  TIMEOUT = "timeout",
  RESOURCE = "resource",
  CONFIGURATION = "configuration",
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: ErrorType[];
}

/**
 * Error classification result
 */
interface ErrorClassification {
  type: ErrorType;
  retryable: boolean;
  suggestedDelay?: number;
  category: string;
}

/**
 * Progress tracking state
 */
interface ProgressState {
  totalFiles: number;
  processedFiles: number;
  currentFile: string;
  currentFormat: string;
  totalFormats: number;
  processedFormats: number;
  startTime: number;
  currentFileStartTime: number;
  estimatedTotalTime?: number;
  estimatedRemainingTime?: number;
}

/**
 * Progress event data
 */
interface ProgressEvent {
  type: "start" | "progress" | "complete" | "error";
  file: string;
  format?: string;
  percentage: number;
  eta?: number;
  currentStep: string;
  filesCompleted: number;
  totalFiles: number;
  formatsCompleted: number;
  totalFormats: number;
  processingTime: number;
  averageTimePerFile?: number;
  averageTimePerFormat?: number;
}

/**
 * Format mapping constants (avoid recreating Maps in loops)
 */

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
  /**
   * Private static maps for format lookups (consistent with API client)
   */
  private static readonly FORMAT_TO_EXTENSION_MAP: ReadonlyMap<string, string> =
    new Map<string, string>([
      ["text", "txt"],
      ["html", "html"],
      ["md", "md"],
      ["json", "json"],
      ["doctags", "doctags"],
    ]);

  private static readonly FORMAT_TO_CONTENT_KEY_MAP: ReadonlyMap<
    string,
    string
  > = new Map<string, string>([
    ["text", "text_content"],
    ["html", "html_content"],
    ["md", "md_content"],
    ["json", "json_content"],
    ["doctags", "doctags_content"],
  ]);

  /**
   * Retry configuration
   */
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    retryableErrors: [
      ErrorType.TRANSIENT,
      ErrorType.TIMEOUT,
      ErrorType.RESOURCE,
    ],
  };

  /**
   * Progress tracking state for enhanced progress reporting
   */
  private progressState: ProgressState = {
    totalFiles: 0,
    processedFiles: 0,
    currentFile: "",
    currentFormat: "",
    totalFormats: 0,
    processedFormats: 0,
    startTime: 0,
    currentFileStartTime: 0,
  };

  /**
   * Performance tracking for ETA calculations
   */
  private performanceHistory: {
    fileProcessingTimes: number[];
    formatProcessingTimes: number[];
  } = {
    fileProcessingTimes: [],
    formatProcessingTimes: [],
  };

  constructor(config: DoclingCLIConfig = { type: "cli" }) {
    this.config = config;
    this.progress = new EventEmitter();
    this.outputDir = config.outputDir || "./output";
    this.pythonPath = config.pythonPath || "python3";
    this.doclingCommand = config.doclingPath || "docling";
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
   * Initialize and verify Docling CLI is available (NestJS service pattern)
   */
  async initialize(): Promise<void> {
    try {
      await this.checkAvailability();
      this.progress.emit("initialized", { status: "ready" });
    } catch (error) {
      this.progress.emit("error", {
        message: "Failed to initialize Docling CLI",
        error,
      });
      throw error;
    }
  }

  /**
   * Check if Docling CLI is available and working (NestJS service pattern)
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
   * Get Docling version information (NestJS service pattern)
   */
  async getVersion(): Promise<string> {
    const executableCandidates = [
      this.doclingCommand,
      `${this.pythonPath} -m ${this.doclingCommand}`,
    ];

    for (const executable of executableCandidates) {
      try {
        const { stdout } = await execAsync(`${executable} --version`);
        this.doclingCommand = executable;
        return stdout.trim();
      } catch (_error) {
        // Ignore errors when detecting executable
      }
    }

    throw new Error(
      "Docling CLI not found. Please install Docling: pip install docling"
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
  ): Promise<ConversionResult> {
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
  ): Promise<ConversionResult> {
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
  ): Promise<ConversionResult> {
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
  ): Promise<ConversionResult> {
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
  ): Promise<ConversionResult> {
    return this.processFile(file, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Process document with advanced options
   */
  async process(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
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
    await this.ensureInitialized();

    const result = await this.processFile(file, filename, options);

    if (result.success === false) {
      return {
        success: false,
        error: result.error,
      };
    }

    const zipFilename = `${basename(filename, extname(filename))}.zip`;

    try {
      const zipBuffer = await this.createZipFromOutputFiles(filename, options);

      return {
        success: true,
        fileStream: this.createBufferStream(zipBuffer),
        fileMetadata: {
          filename: zipFilename,
          contentType: "application/zip",
          size: zipBuffer.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: "Failed to create ZIP file",
          details: error,
        },
      };
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
  ): Promise<ConversionResult> {
    await this.ensureInitialized();
    return this.processFile(file, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Convert using ASYNC approach (CLI with background processing)
   * For CLI, we can simulate async by running in background
   */
  async convertAsync(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    await this.ensureInitialized();

    this.progress.emit("async-start", { file: filename });

    const result = await this.processFile(file, filename, {
      ...this.config.defaultOptions,
      ...options,
    });

    this.progress.emit("async-complete", {
      file: filename,
      success: result.success,
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
  ): Promise<ConversionResult> {
    await this.ensureInitialized();

    try {
      const buffer = await this.streamToBuffer(inputStream);

      this.progress.emit("stream-converted", {
        filename,
        size: buffer.length,
      });

      return this.processFile(buffer, filename, {
        ...this.config.defaultOptions,
        ...options,
      });
    } catch (error) {
      return {
        success: false,
        error: {
          message: "Failed to process input stream",
          details: error instanceof Error ? error.message : String(error),
        },
      };
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
   * Convert document and stream output directly (no memory buffering)
   * Perfect for true passthrough streaming use cases
   * @param returnAsZip - If true, returns ZIP file; if false, returns content directly
   */
  async convertToStream(
    options: CliConvertOptions,
    outputStream: Writable,
    returnAsZip = false
  ): Promise<CliConversionResult> {
    await this.ensureInitialized();
    const streamContext = await this.createCliStreamContext(
      options,
      returnAsZip
    );
    return await this.executeCliStreamRequest(
      streamContext,
      outputStream,
      returnAsZip
    );
  }

  /**
   * Convert with real-time progress monitoring
   * Monitors stderr for progress patterns and memory usage
   */
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

    const args = this.buildCliArgs(options);

    const performanceMarkStart = `docling-cli-progress-${Date.now()}-start`;
    const performanceMarkEnd = `docling-cli-progress-${Date.now()}-end`;

    performance.mark(performanceMarkStart);

    const abortController = new AbortController();

    const memoryInterval = setInterval(() => {
      if (onProgress) {
        onProgress({
          stage: "monitoring",
          memoryUsage: process.memoryUsage(),
        });
      }
    }, 1000);

    try {
      const command = this.doclingCommand || "docling";
      const commandParts = command.includes(" ")
        ? command.split(" ")
        : [command];

      const mainCommand = commandParts[0];
      if (!mainCommand) {
        throw new Error("No command specified");
      }

      const child = spawn(mainCommand, [...commandParts.slice(1), ...args], {
        cwd: this.config.outputDir || process.cwd(),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
        signal: abortController.signal,
      }) as ChildProcess;

      if (child.stdin) {
        child.stdin.end();
      }

      if (child.stderr && onProgress) {
        child.stderr.on("data", (data: Buffer) => {
          const message = data.toString();

          if (message.includes("Processing")) {
            onProgress({ stage: "processing", message: message.trim() });
          } else if (message.includes("Converting")) {
            onProgress({ stage: "converting", message: message.trim() });
          } else if (message.includes("Saving")) {
            onProgress({ stage: "saving", message: message.trim() });
          } else if (message.includes("%")) {
            const percentMatch = message.match(/(\d+)%/);
            if (percentMatch?.[1]) {
              onProgress({
                stage: "progress",
                percentage: Number.parseInt(percentMatch[1], 10),
                message: message.trim(),
              });
            }
          }
        });
      }

      const [processResult, { stdout, stderr }] = await Promise.all([
        this.createProcessPromise(child, abortController.signal),
        this.createOutputPromise(child, abortController.signal),
      ]);

      clearInterval(memoryInterval);
      performance.mark(performanceMarkEnd);

      if (onProgress) {
        onProgress({
          stage: processResult.exitCode === 0 ? "completed" : "failed",
          percentage: 100,
          message:
            processResult.exitCode === 0
              ? "Conversion completed"
              : "Conversion failed",
          memoryUsage: process.memoryUsage(),
        });
      }

      return {
        success: processResult.exitCode === 0,
        exitCode: processResult.exitCode,
        stdout: stdout,
        stderr,
        error: processResult.exitCode !== 0 ? new Error(stderr) : undefined,
        outputFiles: [],
      };
    } catch (error) {
      clearInterval(memoryInterval);
      performance.mark(performanceMarkEnd);

      if (onProgress) {
        onProgress({
          stage: "error",
          message: error instanceof Error ? error.message : String(error),
          memoryUsage: process.memoryUsage(),
        });
      }

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
          source: "http",
          ...(progress.memoryUsage && { memoryUsage: progress.memoryUsage }),
        };

        try {
          progressConfig.onProgress?.(progressUpdate);
        } catch (error) {
          console.error("Error in progress callback:", error);
        }
      });

      if (result.success === true) {
        try {
          await progressConfig.onComplete?.(result);
        } catch (error) {
          console.error("Error in completion callback:", error);
        }
      } else {
        try {
          await progressConfig.onError?.(
            result.error || new Error("Conversion failed")
          );
        } catch (error) {
          console.error("Error in error callback:", error);
        }
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
  ): Promise<ConversionResult> {
    await this.ensureInitialized();

    try {
      const tempDir = await this.createTempDirectory();
      const filename = this.extractFilenameFromUrl(url);
      const tempFilePath = join(tempDir, filename);

      await this.downloadFile(url, tempFilePath);

      this.progress.emit("url-downloaded", { url, tempFilePath });

      const result = await this.processFile(tempFilePath, filename, {
        ...this.config.defaultOptions,
        ...options,
      });

      await this.cleanupTempDirectory(tempDir);

      return result;
    } catch (error) {
      return {
        success: false,
        error: {
          message: `Failed to convert from URL: ${url}`,
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Convert from file path
   * Direct file processing
   */
  async convertFromFile(
    filePath: string,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    await this.ensureInitialized();

    try {
      const filename = basename(filePath);
      return this.processFile(filePath, filename, {
        ...this.config.defaultOptions,
        ...options,
      });
    } catch (error) {
      return {
        success: false,
        error: {
          message: `Failed to convert file: ${filePath}`,
          details: error instanceof Error ? error.message : String(error),
        },
      };
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
  ): Promise<ConversionResult> {
    await this.ensureInitialized();

    try {
      return this.processFile(buffer, filename, {
        ...this.config.defaultOptions,
        ...options,
      });
    } catch (error) {
      return {
        success: false,
        error: {
          message: `Failed to convert buffer for file: ${filename}`,
          details: error instanceof Error ? error.message : String(error),
        },
      };
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
  ): Promise<ConversionResult> {
    try {
      const buffer = Buffer.from(base64String, "base64");
      return this.convertFromBuffer(buffer, filename, options);
    } catch (error) {
      return {
        success: false,
        error: {
          message: `Failed to convert base64 for file: ${filename}`,
          details: error instanceof Error ? error.message : String(error),
        },
      };
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
      result?: ConversionResult;
      error?: string;
    }>;
  }> {
    await this.ensureInitialized();

    const results: Array<{
      filename: string;
      success: boolean;
      result?: ConversionResult;
      error?: string;
    }> = [];

    const fileResults = await Promise.all(
      files.map((file, index) =>
        this.processSingleFile(file, index, files.length, options, onProgress)
      )
    );

    results.push(...fileResults);

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
      outputDir: options?.outputDir || this.outputDir,
      recursive: options?.recursive ?? true,
      patterns: options?.patterns || ["**/*.pdf", "**/*.docx", "**/*.pptx"],
      debounce: options?.debounce || 1000,
    };

    this.progress.emit("watch-start", { directory, options: watchOptions });

    const watcher = chokidarWatch(directory, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on("add", async (filePath) => {
      if (this.shouldProcessFile(filePath, watchOptions.patterns)) {
        this.progress.emit("file-detected", { file: filePath });

        try {
          await this.convert(filePath, basename(filePath));
          this.progress.emit("file-processed", {
            file: filePath,
            success: true,
          });
        } catch (error) {
          this.progress.emit("file-processed", {
            file: filePath,
            success: false,
            error,
          });
        }
      }
    });

    watcher.on("change", async (filePath) => {
      if (this.shouldProcessFile(filePath, watchOptions.patterns)) {
        this.progress.emit("file-changed", { file: filePath });

        this.handleFileChangeWithDebounce(filePath, watchOptions.debounce);
      }
    });

    return new Promise((resolve) => {
      process.on("SIGINT", () => {
        watcher.close();
        this.progress.emit("watch-stop");
        resolve();
      });
    });
  }

  /**
   * Process multiple files in batch
   */
  async batch(
    files: string[],
    options?: ConversionOptions & {
      outputDir?: string;
      parallel?: boolean;
      maxConcurrency?: number;
    }
  ): Promise<{
    success: boolean;
    results: Array<{
      file: string;
      success: boolean;
      output?: string;
      error?: string;
    }>;
  }> {
    const batchOptions = {
      outputDir: options?.outputDir || this.outputDir,
      parallel: options?.parallel ?? true,
      maxConcurrency: options?.maxConcurrency || this.config.concurrency || 4,
    };

    this.progress.emit("batch-start", {
      files: files.length,
      options: batchOptions,
    });

    const results: Array<{
      file: string;
      success: boolean;
      output?: string;
      error?: string;
    }> = [];

    if (batchOptions.parallel) {
      const chunks = this.chunkArray(files, batchOptions.maxConcurrency);

      for (const chunk of chunks) {
        const chunkPromises = chunk.map(async (file) => {
          try {
            const result = await this.convert(file, basename(file), options);
            this.progress.emit("file-completed", {
              file,
              success: result.success,
            });

            const baseResult = {
              file,
              success: result.success,
            };

            if (result.success === true) {
              return { ...baseResult, output: "Converted successfully" };
            }
            return {
              ...baseResult,
              error: result.error?.message || "Unknown error",
            };
          } catch (error) {
            this.progress.emit("file-completed", { file, success: false });
            return {
              file,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        });

        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
      }
    } else {
      for (const file of files) {
        try {
          const result = await this.convert(file, basename(file), options);
          this.progress.emit("file-completed", {
            file,
            success: result.success,
          });

          const batchResult = {
            file,
            success: result.success,
            ...(result.success === true && {
              output: "Converted successfully",
            }),
            ...(result.success === false && {
              error: result.error?.message || "Unknown error",
            }),
          };
          results.push(batchResult);
        } catch (error) {
          this.progress.emit("file-completed", { file, success: false });
          results.push({
            file,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
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
    results: ConversionResult[];
    totalFiles: number;
  }> {
    try {
      const dirStat = await stat(directoryPath);
      if (!dirStat.isDirectory()) {
        throw new Error(`Path is not a directory: ${directoryPath}`);
      }

      const files = await readdir(directoryPath);
      const pdfFiles = files.filter(
        (file: string) => extname(file).toLowerCase() === ".pdf"
      );

      if (pdfFiles.length === 0) {
        return {
          success: true,
          results: [],
          totalFiles: 0,
        };
      }

      const filePaths = pdfFiles.map((file: string) =>
        join(directoryPath, file)
      );
      const batchResult = await this.batch(filePaths, options);

      const conversionResults: ConversionResult[] = batchResult.results.map(
        (result) => {
          if (result.success === true) {
            // This should theoretically have data, but CLI batch processing doesn't provide it
            // For now, create a minimal success response
            return {
              success: true as const,
              data: {
                document: { filename: result.file },
                status: "success" as const,
                processing_time: 0,
              },
            };
          }
          return {
            success: false as const,
            error: {
              message: result.error || "Unknown error",
              details: `Failed to process file: ${result.file}`,
            },
          };
        }
      );

      return {
        success: batchResult.success,
        results: conversionResults,
        totalFiles: pdfFiles.length,
      };
    } catch (_error) {
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
        const supportedExtensions = [
          ".pdf",
          ".docx",
          ".pptx",
          ".xlsx",
          ".txt",
          ".md",
        ];

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
      if (value !== undefined && typeof value === "number") {
        if (value < validation.min || value > validation.max) {
          throw new Error(
            `${validation.name} must be between ${validation.min} and ${validation.max}, got ${value}`
          );
        }
      }
    }

    const enumValidations = new Map([
      ["pdf_backend", ["dlparse_v1", "dlparse_v2", "pypdfium2", "pdfminer"]],
      ["table_mode", ["fast", "accurate"]],
      ["device", ["auto", "cpu", "cuda", "mps"]],
      ["ocr_engine", ["easyocr", "tesseract", "rapidocr"]],
      ["pipeline", ["standard", "vlm", "asr"]],
      ["image_export_mode", ["embedded", "referenced", "none"]],
    ]);

    for (const [key, validValues] of enumValidations) {
      const value = (options as Record<string, unknown>)[key];
      if (value !== undefined && !validValues.includes(value as string)) {
        throw new Error(
          `Invalid ${key}: ${value}. Valid options: ${validValues.join(", ")}`
        );
      }
    }

    if (options.to_formats) {
      const validFormats = ["text", "html", "md", "json", "doctags"];
      const invalidFormats = options.to_formats.filter(
        (f) => !validFormats.includes(f)
      );
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
      const invalidLanguages = options.ocr_lang.filter(
        (lang) => !validLanguages.includes(lang)
      );
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
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        start < 1 ||
        end < start
      ) {
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
      ocr_engine: "easyocr",
      pipeline: "standard",
    };
  }

  /**
   * Merge options with environment defaults and validate
   */
  private prepareOptions(options?: ConversionOptions): ConversionOptions {
    const environmentDefaults = this.getEnvironmentDefaults();
    const mergedOptions = { ...environmentDefaults, ...options };

    this.validateConfiguration(mergedOptions);

    return mergedOptions;
  }

  /**
   * Initialize progress tracking for operation
   */
  private initializeProgress(totalFiles: number, totalFormats: number): void {
    this.progressState = {
      totalFiles,
      processedFiles: 0,
      currentFile: "",
      currentFormat: "",
      totalFormats,
      processedFormats: 0,
      startTime: Date.now(),
      currentFileStartTime: Date.now(),
    };
  }

  /**
   * Calculate current progress percentage
   */
  private calculateProgress(): number {
    if (this.progressState.totalFiles === 0) return 0;

    const fileProgress =
      this.progressState.processedFiles / this.progressState.totalFiles;

    const currentFileFormatProgress =
      this.progressState.totalFormats > 0
        ? this.progressState.processedFormats / this.progressState.totalFormats
        : 0;

    const overallProgress =
      (fileProgress +
        currentFileFormatProgress / this.progressState.totalFiles) *
      100;

    return Math.min(Math.max(overallProgress, 0), 100);
  }

  /**
   * Calculate ETA based on performance history
   */
  private calculateETA(): number | undefined {
    const { fileProcessingTimes, formatProcessingTimes } =
      this.performanceHistory;

    if (
      fileProcessingTimes.length === 0 &&
      formatProcessingTimes.length === 0
    ) {
      return undefined;
    }

    const avgFileTime =
      fileProcessingTimes.length > 0
        ? fileProcessingTimes.reduce((sum, time) => sum + time, 0) /
          fileProcessingTimes.length
        : 0;

    const avgFormatTime =
      formatProcessingTimes.length > 0
        ? formatProcessingTimes.reduce((sum, time) => sum + time, 0) /
          formatProcessingTimes.length
        : 0;

    const remainingFiles =
      this.progressState.totalFiles - this.progressState.processedFiles;
    const remainingFormatsInCurrentFile =
      this.progressState.totalFormats - this.progressState.processedFormats;

    const estimatedRemainingTime =
      remainingFiles * avgFileTime +
      remainingFormatsInCurrentFile * avgFormatTime;

    return estimatedRemainingTime;
  }

  /**
   * Update progress state and emit enhanced progress event
   */
  private updateProgress(
    type: "start" | "progress" | "complete" | "error",
    currentStep: string,
    file?: string,
    format?: string
  ): void {
    if (file) this.progressState.currentFile = file;
    if (format) this.progressState.currentFormat = format;

    const now = Date.now();
    const processingTime = now - this.progressState.startTime;
    const percentage = this.calculateProgress();
    const eta = this.calculateETA();

    const avgFileTime =
      this.performanceHistory.fileProcessingTimes.length > 0
        ? this.performanceHistory.fileProcessingTimes.reduce(
            (sum, time) => sum + time,
            0
          ) / this.performanceHistory.fileProcessingTimes.length
        : undefined;

    const avgFormatTime =
      this.performanceHistory.formatProcessingTimes.length > 0
        ? this.performanceHistory.formatProcessingTimes.reduce(
            (sum, time) => sum + time,
            0
          ) / this.performanceHistory.formatProcessingTimes.length
        : undefined;

    const progressEvent: ProgressEvent = {
      type,
      file: this.progressState.currentFile,
      format: this.progressState.currentFormat,
      percentage: Math.round(percentage * 100) / 100,
      currentStep,
      filesCompleted: this.progressState.processedFiles,
      totalFiles: this.progressState.totalFiles,
      formatsCompleted: this.progressState.processedFormats,
      totalFormats: this.progressState.totalFormats,
      processingTime,
      ...(eta !== undefined && { eta }),
      ...(avgFileTime !== undefined && { averageTimePerFile: avgFileTime }),
      ...(avgFormatTime !== undefined && {
        averageTimePerFormat: avgFormatTime,
      }),
    };

    this.progress.emit("enhanced-progress", progressEvent);
  }

  /**
   * Record file processing completion for performance tracking
   */
  private recordFileCompletion(): void {
    const now = Date.now();
    const fileProcessingTime = now - this.progressState.currentFileStartTime;

    this.performanceHistory.fileProcessingTimes.push(fileProcessingTime);

    if (this.performanceHistory.fileProcessingTimes.length > 10) {
      this.performanceHistory.fileProcessingTimes.shift();
    }

    this.progressState.processedFiles++;
    this.progressState.currentFileStartTime = now;
  }

  /**
   * Record format processing completion for performance tracking
   */
  private recordFormatCompletion(): void {
    const now = Date.now();
    const formatStartTime = this.progressState.currentFileStartTime;
    const formatProcessingTime = now - formatStartTime;

    this.performanceHistory.formatProcessingTimes.push(formatProcessingTime);

    if (this.performanceHistory.formatProcessingTimes.length > 20) {
      this.performanceHistory.formatProcessingTimes.shift();
    }

    this.progressState.processedFormats++;
  }

  /**
   * Classify error for retry logic (NestJS service pattern)
   */
  private classifyError(error: Error, stderr?: string): ErrorClassification {
    const errorMessage = error.message.toLowerCase();
    const stderrContent = (stderr || "").toLowerCase();

    const errorPatterns = new Map<ErrorType, string[]>([
      [
        ErrorType.TIMEOUT,
        [
          "timeout",
          "timed out",
          "connection timeout",
          "read timeout",
          "execution timeout",
          "process timeout",
        ],
      ],
      [
        ErrorType.RESOURCE,
        [
          "out of memory",
          "memory error",
          "disk space",
          "no space left",
          "resource temporarily unavailable",
          "too many open files",
          "connection refused",
          "network unreachable",
        ],
      ],
      [
        ErrorType.TRANSIENT,
        [
          "temporary failure",
          "service unavailable",
          "try again",
          "connection reset",
          "broken pipe",
          "interrupted system call",
          "device busy",
          "resource busy",
        ],
      ],
      [
        ErrorType.CONFIGURATION,
        [
          "command not found",
          "no such file",
          "permission denied",
          "invalid argument",
          "bad option",
          "unknown option",
          "configuration error",
          "invalid configuration",
        ],
      ],
    ]);

    for (const [errorType, patterns] of errorPatterns) {
      const hasMatch = patterns.some(
        (pattern) =>
          errorMessage.includes(pattern) || stderrContent.includes(pattern)
      );

      if (hasMatch) {
        return {
          type: errorType,
          retryable: this.retryConfig.retryableErrors.includes(errorType),
          category: this.getErrorCategory(errorType),
          suggestedDelay: this.calculateDelay(errorType, 1),
        };
      }
    }

    return {
      type: ErrorType.PERMANENT,
      retryable: false,
      category: "Unknown/Permanent",
    };
  }

  /**
   * Get human-readable error category
   */
  private getErrorCategory(errorType: ErrorType): string {
    const categoryMap = new Map([
      [ErrorType.TRANSIENT, "Network/Temporary"],
      [ErrorType.TIMEOUT, "Timeout/Performance"],
      [ErrorType.RESOURCE, "Resource/System"],
      [ErrorType.CONFIGURATION, "Configuration/Setup"],
      [ErrorType.PERMANENT, "Logic/Permanent"],
    ]);

    return categoryMap.get(errorType) || "Unknown";
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateDelay(errorType: ErrorType, attempt: number): number {
    const baseDelay = this.retryConfig.baseDelay;
    const multiplier = this.retryConfig.backoffMultiplier;
    const maxDelay = this.retryConfig.maxDelay;

    const typeMultipliers = new Map([
      [ErrorType.TIMEOUT, 2],
      [ErrorType.RESOURCE, 1.5],
      [ErrorType.TRANSIENT, 1],
    ]);

    const typeMultiplier = typeMultipliers.get(errorType) || 1;
    const delay = Math.min(
      baseDelay * typeMultiplier * multiplier ** (attempt - 1),
      maxDelay
    );

    const jitter = Math.random() * 0.1 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Execute command with retry logic and exponential backoff
   */
  private async executeCommandWithRetry(
    args: string[],
    context: { format?: string; file?: string } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const maxAttempts = this.retryConfig.maxRetries + 1;
    const attempts = Array.from({ length: maxAttempts }, (_, i) => i + 1);

    const errors: Error[] = [];
    const stderrs: string[] = [];

    for (const attempt of attempts) {
      try {
        this.progress.emit("retry-attempt", {
          attempt,
          maxAttempts,
          context,
        });

        const result = await this.executeCommand(args);

        if (attempt > 1) {
          this.progress.emit("retry-success", {
            attempt,
            context,
            recoveredAfter: attempt - 1,
          });
        }

        return result;
      } catch (error) {
        const currentError =
          error instanceof Error ? error : new Error(String(error));
        errors.push(currentError);

        const errorMessage = currentError.message;
        const stderrMatch = errorMessage.match(/stderr: (.+)$/);
        const currentStderr = stderrMatch?.[1] || "";
        stderrs.push(currentStderr);

        const classification = this.classifyError(currentError, currentStderr);

        this.progress.emit("retry-error", {
          attempt,
          error: currentError.message,
          classification,
          context,
        });

        if (attempt >= maxAttempts || !classification.retryable) {
          this.progress.emit("retry-exhausted", {
            totalAttempts: attempt,
            finalError: currentError.message,
            classification,
            context,
          });
          throw currentError;
        }

        const delay = this.calculateDelay(classification.type, attempt);

        this.progress.emit("retry-delay", {
          attempt,
          delay,
          errorType: classification.type,
          context,
        });

        await this.sleep(delay);
      }
    }

    throw errors[errors.length - 1] || new Error("Unknown retry error");
  }

  /**
   * Handle file change with debounce using timers/promises
   */
  private async handleFileChangeWithDebounce(
    filePath: string,
    debounceMs: number
  ): Promise<void> {
    const { setTimeout } = await import("node:timers/promises");
    await setTimeout(debounceMs);
    try {
      await this.convert(filePath, basename(filePath));
      this.progress.emit("file-processed", {
        file: filePath,
        success: true,
      });
    } catch (error) {
      this.progress.emit("file-processed", {
        file: filePath,
        success: false,
        error,
      });
    }
  }

  /**
   * Create a readable stream from a buffer
   */
  private createBufferStream(buffer: Buffer): NodeReadable {
    const { Readable } = require("node:stream");
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
   * Sleep utility for retry delays using timers/promises
   */
  private async sleep(ms: number): Promise<void> {
    const { setTimeout } = await import("node:timers/promises");
    return setTimeout(ms);
  }

  /**
   * Create a promise that resolves when the child process exits
   */
  private createProcessPromise(
    child: ChildProcess,
    signal: AbortSignal
  ): Promise<{ exitCode: number }> {
    return new Promise((resolve, reject) => {
      child.on("exit", (code) => {
        resolve({ exitCode: code || 0 });
      });

      child.on("error", (error) => {
        reject(error);
      });

      signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        reject(new Error("Process aborted"));
      });
    });
  }

  /**
   * Create a promise that captures stdout and stderr
   */
  private createOutputPromise(
    child: ChildProcess,
    signal: AbortSignal
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      if (child.stdout) {
        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      }

      child.on("exit", () => {
        resolve({ stdout, stderr });
      });

      child.on("error", (error) => {
        reject(error);
      });

      signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
        reject(new Error("Process aborted"));
      });
    });
  }

  /**
   * Build CLI arguments from CliConvertOptions
   */
  private buildCliArgs(options: CliConvertOptions): string[] {
    const args: string[] = [];

    if (options.fromFormats && options.fromFormats.length > 0) {
      args.push("--from", ...options.fromFormats.map(String));
    }
    if (options.toFormats && options.toFormats.length > 0) {
      args.push("--to", ...options.toFormats.map(String));
    }
    if (options.output) {
      args.push("--output", String(options.output));
    }

    if (options.pipeline) args.push("--pipeline", String(options.pipeline));
    if (options.vlmModel) args.push("--vlm-model", String(options.vlmModel));
    if (options.asrModel) args.push("--asr-model", String(options.asrModel));

    if (options.ocr) args.push("--ocr");
    if (options.forceOcr) args.push("--force-ocr");
    if (options.ocrEngine) args.push("--ocr-engine", String(options.ocrEngine));
    if (options.ocrLang?.length) {
      for (const lang of options.ocrLang) args.push("--ocr-lang", String(lang));
    }

    if (options.pdfBackend)
      args.push("--pdf-backend", String(options.pdfBackend));

    if (options.tableMode) args.push("--table-mode", String(options.tableMode));

    if (options.imageExportMode)
      args.push("--image-export-mode", String(options.imageExportMode));
    if (options.showLayout) args.push("--show-layout");

    if (options.enrichCode) args.push("--enrich-code");
    if (options.enrichFormula) args.push("--enrich-formula");
    if (options.enrichPictureClasses) args.push("--enrich-picture-classes");
    if (options.enrichPictureDescriptions)
      args.push("--enrich-picture-description");
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

    if (options.artifactsPath)
      args.push("--artifacts-path", String(options.artifactsPath));
    if (options.enableRemoteServices) args.push("--enable-remote-services");
    if (options.allowExternalPlugins) args.push("--allow-external-plugins");
    if (options.showExternalPlugins) args.push("--show-external-plugins");

    if (options.debugVisualizeCells) args.push("--debug-visualize-cells");
    if (options.debugVisualizeOcr) args.push("--debug-visualize-ocr");
    if (options.debugVisualizeLayout) args.push("--debug-visualize-layout");
    if (options.debugVisualizeTables) args.push("--debug-visualize-tables");

    if (options.headers) args.push("--headers", String(options.headers));

    if (typeof options.verbose === "number") {
      args.push("--verbose", String(options.verbose));
    }

    if (options.sources && options.sources.length > 0) {
      args.push(...options.sources.map(String));
    }

    return args;
  }

  /**
   * Create CLI stream context with performance tracking and temp directory
   */
  private async createCliStreamContext(
    options: CliConvertOptions,
    returnAsZip: boolean
  ): Promise<{
    tempDir: string;
    abortController: AbortController;
    performanceMarkStart: string;
    performanceMarkEnd: string;
    streamOptions: CliConvertOptions;
    args: string[];
    command: string;
    commandParts: string[];
  }> {
    const performanceMarkStart = `docling-cli-stream-${Date.now()}-start`;
    const performanceMarkEnd = `docling-cli-stream-${Date.now()}-end`;

    performance.mark(performanceMarkStart);

    const abortController = new AbortController();

    const tempDir = await mkdtemp(join(tmpdir(), "docling-stream-"));

    const streamOptions = {
      ...options,
      output: tempDir,
      ...(returnAsZip && { zip: true }),
    };
    const args = this.buildCliArgs(streamOptions);

    const command = this.doclingCommand || "docling";
    const commandParts = command.includes(" ") ? command.split(" ") : [command];

    return {
      tempDir,
      abortController,
      performanceMarkStart,
      performanceMarkEnd,
      streamOptions,
      args,
      command,
      commandParts,
    };
  }

  /**
   * Execute CLI stream request using Map-based dispatch
   */
  private async executeCliStreamRequest(
    context: {
      tempDir: string;
      abortController: AbortController;
      performanceMarkStart: string;
      performanceMarkEnd: string;
      streamOptions: CliConvertOptions;
      args: string[];
      command: string;
      commandParts: string[];
    },
    outputStream: Writable,
    returnAsZip = false
  ): Promise<CliConversionResult> {
    try {
      const child = this.spawnCliProcess(context);
      const result = await this.processCliStream(
        context,
        child,
        outputStream,
        returnAsZip
      );

      performance.mark(context.performanceMarkEnd);
      await this.cleanupTempDirectory(context.tempDir);

      return result;
    } catch (error) {
      performance.mark(context.performanceMarkEnd);
      await this.cleanupTempDirectory(context.tempDir);
      throw error;
    }
  }

  /**
   * Spawn CLI process with proper configuration
   */
  private spawnCliProcess(context: {
    commandParts: string[];
    args: string[];
    abortController: AbortController;
  }): ChildProcess {
    const mainCommand = context.commandParts[0];
    if (!mainCommand) {
      throw new Error("No command specified in context");
    }

    const child = spawn(
      mainCommand,
      [...context.commandParts.slice(1), ...context.args],
      {
        cwd: this.config.outputDir || process.cwd(),
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
        signal: context.abortController.signal,
      }
    ) as ChildProcess;

    if (child.stdin) {
      child.stdin.end();
    }

    return child;
  }

  /**
   * Process CLI stream with early return pattern
   */
  private async processCliStream(
    context: {
      tempDir: string;
      streamOptions: CliConvertOptions;
      abortController: AbortController;
    },
    child: ChildProcess,
    outputStream: Writable,
    returnAsZip = false
  ): Promise<CliConversionResult> {
    const streamHandlers = new Map([
      ["zip", () => this.processZipStream(context, child, outputStream)],
      [
        "content",
        () => this.processContentStream(context, child, outputStream),
      ],
    ]);

    const handlerKey = returnAsZip ? "zip" : "content";
    const handler = streamHandlers.get(handlerKey);
    if (!handler) {
      throw new Error(`Unknown stream handler: ${handlerKey}`);
    }
    return await handler();
  }

  /**
   * Process content stream (direct file streaming)
   */
  private async processContentStream(
    context: {
      tempDir: string;
      streamOptions: CliConvertOptions;
      abortController: AbortController;
    },
    child: ChildProcess,
    outputStream: Writable
  ): Promise<CliConversionResult> {
    const streamPromise = this.streamOutputFiles(
      context.tempDir,
      context.streamOptions,
      outputStream,
      context.abortController.signal
    );

    const [processResult, { stderr }] = await Promise.all([
      this.createProcessPromise(child, context.abortController.signal),
      this.createOutputPromise(child, context.abortController.signal),
      streamPromise,
    ]);

    return {
      success: processResult.exitCode === 0,
      exitCode: processResult.exitCode,
      stdout: "",
      stderr,
      error: processResult.exitCode !== 0 ? new Error(stderr) : undefined,
      outputFiles: [],
    };
  }

  /**
   * Process ZIP stream (collect files and create ZIP)
   */
  private async processZipStream(
    context: {
      tempDir: string;
      streamOptions: CliConvertOptions;
      abortController: AbortController;
    },
    child: ChildProcess,
    outputStream: Writable
  ): Promise<CliConversionResult> {
    const [processResult, { stderr }] = await Promise.all([
      this.createProcessPromise(child, context.abortController.signal),
      this.createOutputPromise(child, context.abortController.signal),
    ]);

    if (processResult.exitCode !== 0) {
      return {
        success: false,
        exitCode: processResult.exitCode,
        stdout: "",
        stderr,
        error: new Error(stderr),
        outputFiles: [],
      };
    }

    await this.createZipFromTempDir(context.tempDir, outputStream);

    return {
      success: true,
      exitCode: 0,
      stdout: "",
      stderr,
      error: undefined,
      outputFiles: [],
    };
  }

  /**
   * Create ZIP from temp directory and stream to output
   */
  private async createZipFromTempDir(
    tempDir: string,
    outputStream: Writable
  ): Promise<void> {
    try {
      const files = await readdir(tempDir, { recursive: true });
      const outputFiles = files.filter(
        (file: string): file is string =>
          typeof file === "string" &&
          (file.endsWith(".md") ||
            file.endsWith(".json") ||
            file.endsWith(".html") ||
            file.endsWith(".txt"))
      );

      if (outputFiles.length > 0) {
        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.pipe(outputStream);

        for (const file of outputFiles) {
          const filePath = join(tempDir, file);
          archive.file(filePath, { name: file });
        }

        await archive.finalize();
      } else {
        outputStream.end();
      }
    } catch (error) {
      outputStream.destroy(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Monitor temporary directory for output files and stream them as they're created
   * Uses file system watching and polling for reliable file detection
   */
  private async streamOutputFiles(
    tempDir: string,
    options: CliConvertOptions,
    outputStream: Writable,
    signal: AbortSignal
  ): Promise<void> {
    const expectedExtensions = this.getExpectedExtensions(
      options.toFormats || ["md"]
    );
    const streamedFiles = new Set<string>();
    let isCompleted = false;

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        isCompleted = true;
        if (watcher) {
          watcher.close();
        }
        if (pollInterval) {
          clearInterval(pollInterval);
        }
      };

      signal.addEventListener("abort", () => {
        cleanup();
        reject(new Error("Streaming aborted"));
      });

      let watcher: ReturnType<typeof fsWatch> | undefined;
      try {
        watcher = fsWatch(
          tempDir,
          { recursive: true },
          async (_: string, filename: string | null) => {
            if (isCompleted || !filename) return;

            try {
              await this.handleFileEvent(
                join(tempDir, filename),
                expectedExtensions,
                streamedFiles,
                outputStream
              );
            } catch (error) {
              console.warn("File streaming error:", error);
            }
          }
        );
      } catch (error) {
        console.warn("File watching failed, using polling:", error);
      }

      const pollInterval = setInterval(async () => {
        if (isCompleted) return;

        try {
          await this.pollForFiles(
            tempDir,
            expectedExtensions,
            streamedFiles,
            outputStream
          );
        } catch (error) {
          console.warn("Polling error:", error);
        }
      }, 100);

      const completionCheck = setInterval(async () => {
        if (isCompleted) return;

        try {
          const files = await readdir(tempDir);
          const relevantFiles = files.filter((file: string) =>
            expectedExtensions.some((ext: string) => file.endsWith(ext))
          );

          if (
            relevantFiles.length > 0 &&
            relevantFiles.every((file: string) => streamedFiles.has(file))
          ) {
            cleanup();
            clearInterval(completionCheck);
            outputStream.end();
            resolve();
          }
        } catch (_error) {
          // Ignore errors when checking file status
        }
      }, 200);

      setTimeout(() => {
        cleanup();
        clearInterval(completionCheck);
        outputStream.end();
        resolve();
      }, 30000);
    });
  }

  /**
   * Handle individual file events from file system watcher
   */
  private async handleFileEvent(
    filePath: string,
    expectedExtensions: string[],
    streamedFiles: Set<string>,
    outputStream: Writable
  ): Promise<void> {
    const filename = basename(filePath);

    if (!expectedExtensions.some((ext: string) => filename.endsWith(ext))) {
      return;
    }

    if (streamedFiles.has(filename)) {
      return;
    }

    try {
      await this.waitForFileStable(filePath);

      const fileStream = createReadStream(filePath);

      await new Promise<void>((resolve, reject) => {
        fileStream.on("error", reject);
        fileStream.on("end", resolve);

        fileStream.pipe(outputStream, { end: false });
      });

      streamedFiles.add(filename);
    } catch (_error) {
      // Ignore errors when tracking streamed files
    }
  }

  /**
   * Poll directory for new files (fallback when file watching fails)
   */
  private async pollForFiles(
    tempDir: string,
    expectedExtensions: string[],
    streamedFiles: Set<string>,
    outputStream: Writable
  ): Promise<void> {
    try {
      const files = await readdir(tempDir);

      for (const file of files) {
        if (
          expectedExtensions.some((ext: string) => file.endsWith(ext)) &&
          !streamedFiles.has(file)
        ) {
          await this.handleFileEvent(
            join(tempDir, file),
            expectedExtensions,
            streamedFiles,
            outputStream
          );
        }
      }
    } catch (_error) {
      // Ignore errors when polling directory
    }
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
    result?: ConversionResult;
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
        success: result.success,
        result,
      };
    } catch (error) {
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
  ): Promise<ConversionResult> {
    if (file.buffer) {
      return await this.convertFromBuffer(file.buffer, file.filename, options);
    }
    if (file.filePath) {
      return await this.convertFromFile(file.filePath, options);
    }
    throw new Error("Either buffer or filePath must be provided");
  }

  /**
   * Find alternative file from a list of paths
   */
  private async findAlternativeFile(
    paths: string[]
  ): Promise<{ content: string; path: string } | null> {
    for (const path of paths) {
      try {
        const content = await readFile(path, "utf-8");
        return { content, path };
      } catch {
        // Ignore errors
        // Continue to next path if file cannot be read
      }
    }
    return null;
  }

  /**
   * Prepare input file (handle Buffer or file path)
   */
  private async prepareInputFile(
    file: Buffer | string,
    filename: string
  ): Promise<{ inputPath: string; tempFile: boolean }> {
    if (Buffer.isBuffer(file)) {
      const inputPath = join(this.outputDir, `temp_${Date.now()}_${filename}`);
      await writeFile(inputPath, file);
      return { inputPath, tempFile: true };
    }

    return { inputPath: file, tempFile: false };
  }

  /**
   * Wait for file to be stable (fully written)
   */
  private async waitForFileStable(filePath: string): Promise<void> {
    return this.checkFileStability(filePath, 0, 0);
  }

  /**
   * Process a single format for file conversion
   */
  private async processSingleFormat(
    format: string,
    index: number,
    totalFormats: number,
    filename: string,
    inputPath: string,
    validatedOptions: ConversionOptions,
    allOutputFiles: Record<string, string>,
    allDocumentContent: Record<string, unknown>
  ): Promise<{
    format: string;
    success: boolean;
    outputFiles?: Record<string, string>;
    error?: string;
  }> {
    this.progress.emit("format-processing-start", {
      file: filename,
      format,
      progress: index + 1,
      total: totalFormats,
    });

    this.updateProgress(
      "progress",
      `Processing format ${format}`,
      filename,
      format
    );

    const singleFormatOptions: ConversionOptions = {
      ...validatedOptions,
      to_formats: [format as OutputFormat],
    };

    const command = await this.buildDoclingCommand(
      inputPath,
      singleFormatOptions
    );

    this.progress.emit("command-built", { command, format });

    try {
      const args = command.split(" ").slice(1);

      await this.executeCommandWithRetry(args, {
        format: format,
        file: filename,
      });

      const parsedResult = await this.parseDoclingOutput(
        filename,
        inputPath,
        singleFormatOptions
      );

      Object.assign(allOutputFiles, parsedResult.outputFiles);
      Object.assign(allDocumentContent, parsedResult.data.document || {});

      this.recordFormatCompletion();
      this.updateProgress(
        "progress",
        `Completed format ${format}`,
        filename,
        format
      );

      this.progress.emit("format-processing-complete", {
        file: filename,
        format,
        progress: index + 1,
        total: totalFormats,
        outputFiles: parsedResult.outputFiles,
      });

      return { format, success: true, outputFiles: parsedResult.outputFiles };
    } catch (formatError) {
      const error =
        formatError instanceof Error
          ? formatError
          : new Error(String(formatError));

      const classification = this.classifyError(error);

      this.progress.emit("format-processing-error", {
        file: filename,
        format,
        error: error.message,
        classification,
        retryable: classification.retryable,
        category: classification.category,
      });

      return { format, success: false, error: error.message };
    }
  }

  /**
   * Recursively check file stability
   */
  private async checkFileStability(
    filePath: string,
    previousSize = 0,
    stableCount = 0
  ): Promise<void> {
    if (stableCount >= 3) {
      return;
    }

    try {
      const stats = await stat(filePath);
      const newStableCount = stats.size === previousSize ? stableCount + 1 : 0;

      const { setTimeout } = await import("node:timers/promises");
      await setTimeout(50);

      return this.checkFileStability(filePath, stats.size, newStableCount);
    } catch (_error) {
      const { setTimeout } = await import("node:timers/promises");
      await setTimeout(50);
      return this.checkFileStability(filePath, previousSize, 0);
    }
  }

  /**
   * Get expected file extensions based on output formats
   */
  private getExpectedExtensions(formats: string[]): string[] {
    return formats.map(
      (format) =>
        `.${DoclingCLIClient.FORMAT_TO_EXTENSION_MAP.get(format) || format}`
    );
  }

  /**
   * Process a single file using real Docling CLI
   */
  private async processFile(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    try {
      await mkdir(this.outputDir, { recursive: true });

      const fileInfo = await this.prepareInputFile(file, filename);
      const { inputPath, tempFile } = fileInfo;

      this.progress.emit("processing-start", { file: filename, inputPath });

      const validatedOptions = this.prepareOptions(options);

      const formats = validatedOptions?.to_formats || ["text"];
      const allOutputFiles: Record<string, string> = {};
      const allDocumentContent: Record<string, unknown> = {};

      this.initializeProgress(1, formats.length);
      this.updateProgress("start", "Initializing processing", filename);

      this.progress.emit("multi-format-start", {
        file: filename,
        formats,
        totalFormats: formats.length,
      });

      const formatResults = await Promise.all(
        formats.map((format, index) =>
          this.processSingleFormat(
            format,
            index,
            formats.length,
            filename,
            inputPath,
            validatedOptions,
            allOutputFiles,
            allDocumentContent
          )
        )
      );

      const successfulFormats = formatResults.filter(
        (result) => result.success
      );
      const failedFormats = formatResults.filter((result) => !result.success);

      if (failedFormats.length > 0) {
        this.progress.emit("conversion-partial-failure", {
          file: filename,
          successful: successfulFormats.length,
          failed: failedFormats.length,
          failedFormats: failedFormats.map((f) => f.format),
        });
      }

      if (tempFile) {
        try {
          await unlink(inputPath);
        } catch (cleanupError) {
          this.progress.emit("cleanup-warning", { error: cleanupError });
        }
      }

      this.recordFileCompletion();
      this.updateProgress("complete", "Processing completed", filename);

      this.progress.emit("multi-format-complete", {
        file: filename,
        success: true,
        totalFormats: formats.length,
        processedFormats: Object.keys(allOutputFiles).length,
        outputFiles: allOutputFiles,
      });

      const processingTime = Date.now() - this.progressState.startTime;

      return {
        success: true,
        data: {
          document: {
            filename,
            ...allDocumentContent,
          },
          status: "success",
          processing_time: processingTime,
        },
      };
    } catch (error) {
      this.progress.emit("processing-error", {
        file: filename,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: {
          message: `Docling CLI processing failed for ${filename}`,
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Argument builders map (inspired by NestJS DoclingCLIService pattern)
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

    [
      "do_ocr",
      (enable: unknown) => (enable !== false ? ["--ocr"] : ["--no-ocr"]),
    ],
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
        return ["--from", formats.join(",")];
      },
    ],

    ["table_mode", (mode: unknown) => ["--table-mode", String(mode)]],
    [
      "do_table_structure",
      (enable: unknown) => (enable ? ["--do-table-structure"] : []),
    ],
    [
      "table_batch_size",
      (size: unknown) => ["--table-batch-size", String(size)],
    ],

    [
      "do_code_enrichment",
      (enable: unknown) => (enable ? ["--enrich-code"] : []),
    ],
    [
      "do_formula_enrichment",
      (enable: unknown) => (enable ? ["--enrich-formula"] : []),
    ],
    [
      "do_picture_classification",
      (enable: unknown) => (enable ? ["--enrich-picture-classes"] : []),
    ],
    [
      "do_picture_description",
      (enable: unknown) => (enable ? ["--enrich-picture-description"] : []),
    ],

    ["pipeline", (pipeline: unknown) => ["--pipeline", String(pipeline)]],
    [
      "processing_pipeline",
      (pipeline: unknown) => ["--pipeline", String(pipeline)],
    ],
    [
      "abort_on_error",
      (enable: unknown) =>
        enable ? ["--abort-on-error"] : ["--no-abort-on-error"],
    ],
    [
      "document_timeout",
      (timeout: unknown) => ["--document-timeout", String(timeout)],
    ],
    ["num_threads", (threads: unknown) => ["--num-threads", String(threads)]],
    ["device", (device: unknown) => ["--device", String(device)]],

    ["artifacts_path", (path: unknown) => ["--artifacts-path", String(path)]],
    [
      "allow_external_plugins",
      (enable: unknown) => (enable ? ["--allow-external-plugins"] : []),
    ],

    ["images_scale", (scale: unknown) => ["--images-scale", String(scale)]],
    [
      "generate_page_images",
      (enable: unknown) => (enable ? ["--generate-page-images"] : []),
    ],
    [
      "generate_picture_images",
      (enable: unknown) => (enable ? ["--generate-picture-images"] : []),
    ],
    [
      "image_export_mode",
      (mode: unknown) => ["--image-export-mode", String(mode)],
    ],

    [
      "debug_visualize_cells",
      (enable: unknown) => (enable ? ["--debug-visualize-cells"] : []),
    ],
    [
      "debug_visualize_ocr",
      (enable: unknown) => (enable ? ["--debug-visualize-ocr"] : []),
    ],
    [
      "debug_visualize_layout",
      (enable: unknown) => (enable ? ["--debug-visualize-layout"] : []),
    ],
    [
      "debug_visualize_tables",
      (enable: unknown) => (enable ? ["--debug-visualize-tables"] : []),
    ],

    ["export_json", (enable: unknown) => (enable ? ["--export-json"] : [])],
    ["export_html", (enable: unknown) => (enable ? ["--export-html"] : [])],
    [
      "export_html_split_page",
      (enable: unknown) => (enable ? ["--export-html-split-page"] : []),
    ],
    ["export_md", (enable: unknown) => (enable ? ["--export-md"] : [])],
    ["export_txt", (enable: unknown) => (enable ? ["--export-txt"] : [])],
    [
      "export_doctags",
      (enable: unknown) => (enable ? ["--export-doctags"] : []),
    ],
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
    [
      "layout_batch_size",
      (size: unknown) => ["--layout-batch-size", String(size)],
    ],
    [
      "batch_timeout_seconds",
      (timeout: unknown) => ["--batch-timeout", String(timeout)],
    ],
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

    [
      "create_legacy_output",
      (enable: unknown) => (enable ? ["--create-legacy-output"] : []),
    ],
    [
      "enable_remote_services",
      (enable: unknown) => (enable ? ["--enable-remote-services"] : []),
    ],
  ]);

  /**
   * Build Docling CLI command with options (using argument builder pattern)
   */
  private async buildDoclingCommand(
    inputPath: string,
    options?: ConversionOptions
  ): Promise<string> {
    const baseArgsMap = new Map<string, string[]>([
      ["input", [`"${inputPath}"`]],
      ["output", ["--output", `"${this.outputDir}"`]],
    ]);

    const baseArgs = Array.from(baseArgsMap.values()).flat();

    const optionArgs = Object.entries(options || {})
      .filter(([_, value]) => value !== undefined && value !== null)
      .flatMap(([key, value]) => {
        const builder = this.argBuilders.get(key);
        return builder ? builder(value) : [];
      });

    const verboseArgs = this.config.verbose ? ["--verbose"] : [];

    const allArgs = [...baseArgs, ...optionArgs, ...verboseArgs];

    return `${this.doclingCommand} ${allArgs.join(" ")}`;
  }

  /**
   * Execute Docling CLI command (NestJS service pattern)
   */
  async executeCommand(
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const command = `${this.doclingCommand} ${args.join(" ")}`;

    return new Promise((resolve, reject) => {
      const child = exec(command, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: this.config.timeout || 300000,
      });

      let stdout = "";
      let stderr = "";

      if (child.stdout) {
        child.stdout.on("data", (data) => {
          stdout += data;
          this.progress.emit("stdout", { data: data.toString() });
        });
      }

      if (child.stderr) {
        child.stderr.on("data", (data) => {
          stderr += data;
          this.progress.emit("stderr", { data: data.toString() });
        });
      }

      child.on("close", (code) => {
        const result = { stdout, stderr, exitCode: code || 0 };
        if (code === 0) {
          resolve(result);
        } else {
          reject(
            new Error(`Docling CLI exited with code ${code}. stderr: ${stderr}`)
          );
        }
      });

      child.on("error", (error) => {
        reject(new Error(`Failed to execute Docling CLI: ${error.message}`));
      });
    });
  }

  /**
   * Clean up resources and listeners
   */
  destroy(): void {
    this.progress.removeAllListeners();
  }

  /**
   * Parse Docling CLI output and read generated files
   */
  private async parseDoclingOutput(
    filename: string,
    inputPath: string,
    options?: ConversionOptions
  ): Promise<{
    data: { document: Record<string, string> };
    outputFiles: Record<string, string>;
  }> {
    const formats = options?.to_formats || ["text"];
    const baseName = basename(filename, extname(filename));
    const outputFiles: Record<string, string> = {};
    const data: { document: Record<string, string> } = {
      document: {},
    };

    for (const format of formats) {
      try {
        const fileExtension =
          DoclingCLIClient.FORMAT_TO_EXTENSION_MAP.get(format) || format;
        const contentKey =
          DoclingCLIClient.FORMAT_TO_CONTENT_KEY_MAP.get(format) ||
          `${format}_content`;

        const inputBaseName = basename(inputPath, extname(inputPath));
        const outputPath = join(
          this.outputDir,
          `${inputBaseName}.${fileExtension}`
        );

        try {
          const content = await readFile(outputPath, "utf-8");
          data.document[contentKey] = content;
          outputFiles[format] = outputPath;

          this.progress.emit("file-read", {
            format,
            path: outputPath,
            size: content.length,
          });
        } catch (_readError) {
          const alternativePaths = [
            join(this.outputDir, `${baseName}.${fileExtension}`),
            join(this.outputDir, `${inputBaseName}_converted.${fileExtension}`),
            join(this.outputDir, `${inputBaseName}_output.${fileExtension}`),
            join(this.outputDir, `output.${fileExtension}`),
          ];

          const foundFile = await this.findAlternativeFile(alternativePaths);

          if (foundFile) {
            data.document[contentKey] = foundFile.content;
            outputFiles[format] = foundFile.path;

            this.progress.emit("file-read", {
              format,
              path: foundFile.path,
              size: foundFile.content.length,
            });
          }

          if (!foundFile) {
            this.progress.emit("file-not-found", {
              format,
              expectedPath: outputPath,
              triedPaths: [outputPath, ...alternativePaths],
            });
          }
        }
      } catch (error) {
        this.progress.emit("parse-error", {
          format,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { data, outputFiles };
  }

  /**
   * Check if file should be processed based on patterns
   */
  private shouldProcessFile(filePath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        return regex.test(filePath);
      }
      return filePath.endsWith(pattern);
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

  /**
   * Create ZIP file from output files using archiver
   */
  private async createZipFromOutputFiles(
    filename: string,
    options?: ConversionOptions
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      archive.on("end", () => {
        resolve(Buffer.concat(chunks));
      });

      archive.on("error", (error: Error) => {
        reject(error);
      });

      const baseName = basename(filename, extname(filename));
      const formats = options?.to_formats || ["text"];

      for (const format of formats) {
        const fileExtension =
          DoclingCLIClient.FORMAT_TO_EXTENSION_MAP.get(format) || format;

        const outputPath = join(this.outputDir, `${baseName}.${fileExtension}`);

        try {
          archive.file(outputPath, { name: `${baseName}.${fileExtension}` });
        } catch (_error) {
          this.progress.emit("zip-file-missing", { path: outputPath, format });
        }
      }

      archive.finalize();
    });
  }

  /**
   * Split array into chunks (functional single-line version)
   */
  private chunkArray = <T>(arr: T[], size: number): T[][] =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );

  /**
   * Create temporary directory for file operations
   */
  private async createTempDirectory(): Promise<string> {
    const tempDir = join(tmpdir(), `docling-cli-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Clean up temporary directory
   */
  private async cleanupTempDirectory(tempDir: string): Promise<void> {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup temp directory: ${tempDir}`, error);
    }
  }

  /**
   * Extract filename from URL
   */
  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = basename(pathname);

      if (!filename || !filename.includes(".")) {
        const hostname = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, "_");
        return `${hostname}_document.pdf`;
      }

      return filename;
    } catch {
      // Ignore errors
      // Return fallback filename if URL parsing fails
      return `document_${Date.now()}.pdf`;
    }
  }

  /**
   * Download file from URL to local path
   */
  private async downloadFile(url: string, outputPath: string): Promise<void> {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const writeStream = createWriteStream(outputPath);

      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          await new Promise<void>((resolve, reject) => {
            writeStream.write(value, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        }
      } finally {
        reader.releaseLock();
        writeStream.end();
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
    } catch (error) {
      throw new Error(
        `Failed to download file from ${url}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
