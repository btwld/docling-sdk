import type { EventEmitter } from "node:events";
import type { AsyncTaskManager } from "../services/async-task-manager";
import type { FileService } from "../services/file";
import type { Result } from "../utils/result";
import type {
  AcceleratorOptions,
  AsyncConversionTask,
  ConversionFileResult,
  ConversionOptions,
  ConversionResult,
  ConversionTarget,
  ConvertDocumentResponse,
  ConvertDocumentsRequest,
  FileSource,
  FileUploadParams,
  HealthCheckResponse,
  HttpSource,
  LayoutOptions,
  OcrEngine,
  OcrOptions,
  PdfBackend,
  ProcessingPipeline,
  S3Source,
  TableMode,
  TaskStatusResponse,
} from "./api";

/**
 * Progress update data
 */
export interface ProgressUpdate {
  stage: string;
  percentage?: number;
  message?: string;
  taskId?: string;
  position?: number;
  status?: string;
  timestamp: number;
  source?: "websocket" | "http";
  memoryUsage?: NodeJS.MemoryUsage;
  uploadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
}

/**
 * Processing error interface
 */
export interface ProcessingError {
  message: string;
  code?: string;
  details?: unknown;
}

/**
 * Result-based conversion result for better error handling
 */
export type SafeConversionResult = Result<ConversionResult, ProcessingError>;

/**
 * Result-based file conversion result
 */
export type SafeFileConversionResult = Result<
  ConversionFileResult,
  ProcessingError
>;

/**
 * Progress tracking configuration
 */
export interface ProgressConfig {
  method?: "websocket" | "http" | "hybrid";
  websocketTimeout?: number;
  httpPollInterval?: number;

  onProgress?: (progress: ProgressUpdate) => void;
  onComplete?: (result: unknown) => Promise<void> | void;
  onError?: (error: Error) => Promise<void> | void;
  onWebhook?: (webhookData: Record<string, unknown>) => Promise<void> | void;
}

/**
 * Shared configuration properties for all Docling clients
 */
export interface DoclingSharedConfig {
  defaultOptions?: ConversionOptions;
  retries?: number;
  timeout?: number;

  ocr_engine?: OcrEngine;
  ocr_options?: OcrOptions;

  pdf_backend?: PdfBackend;
  table_mode?: TableMode;
  pipeline?: ProcessingPipeline;

  accelerator_options?: AcceleratorOptions;

  layout_options?: LayoutOptions;
}

/**
 * New discriminated union configuration for Docling clients
 */
export type DoclingConfig =
  | ({
      api: {
        baseUrl: string;
        apiKey?: string;
        timeout?: number;
        retries?: number;
        headers?: Record<string, string>;
      };
      cli?: never;
      progress?: ProgressConfig;
    } & DoclingSharedConfig)
  | ({
      cli: {
        outputDir?: string;
        verbose?: boolean;
        progressBar?: boolean;
        tempDir?: string;
        concurrency?: number;
      };
      api?: never;
      progress?: ProgressConfig;
    } & DoclingSharedConfig);

/**
 * Legacy API-specific configuration (for internal use)
 */
export interface DoclingAPIConfig extends DoclingSharedConfig {
  type: "api";
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  retries?: number;
  headers?: Record<string, string>;
  progress?: ProgressConfig;
}

/**
 * Legacy CLI-specific configuration (for internal use)
 */
export interface DoclingCLIConfig extends DoclingSharedConfig {
  type: "cli";
  outputDir?: string;
  verbose?: boolean;
  progressBar?: boolean;
  tempDir?: string;
  concurrency?: number;
  progress?: ProgressConfig;
  pythonPath?: string;
  doclingPath?: string;
}

/**
 * Base interface that all Docling clients must implement
 * Contains the core methods that work across API and CLI
 */
export interface DoclingClientBase {
  /**
   * Convert document to various formats
   */
  convert(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Extract text content from document
   */
  extractText(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConversionResult>;

  /**
   * Convert document to HTML format
   */
  toHtml(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConversionResult>;

  /**
   * Convert document to Markdown format
   */
  toMarkdown(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConversionResult>;

  /**
   * Convert document to multiple formats
   */
  convertDocument(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Process document with advanced options
   */
  process(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Convert document and return as downloadable files
   */
  convertToFile(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionFileResult>;

  /**
   * Safe convert method using Result pattern
   */
  safeConvert(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<SafeConversionResult>;

  /**
   * Safe convert to file method using Result pattern
   */
  safeConvertToFile(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<SafeFileConversionResult>;
}

/**
 * API-specific client interface
 * Extends base with HTTP/network-specific methods
 */
export interface DoclingAPI extends DoclingClientBase {
  /**
   * Convert using SYNC endpoint (fast JSON responses)
   */
  convertSync(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Convert using ASYNC endpoint (advanced workflows)
   */
  convertAsync(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Convert input stream (perfect for NestJS/Express)
   */
  convertStream(
    inputStream: NodeJS.ReadableStream,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Convert input stream to ZIP file
   */
  convertStreamToFile(
    inputStream: NodeJS.ReadableStream,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionFileResult>;

  /**
   * API-only per-method progress override for overlap methods
   * Providing `progress` will enable hybrid/websocket/http tracking for this call
   */
  convert(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;

  toHtml(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;

  toMarkdown(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;

  convertDocument(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;

  process(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;

  convertToFile(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionFileResult>;

  /**
   * Access to file service for advanced operations
   */
  readonly files: FileService;

  /**
   * Get task manager for EventEmitter access
   */
  getTaskManager(): AsyncTaskManager;

  // Core API methods
  /**
   * Check API health status
   */
  health(): Promise<HealthCheckResponse>;

  /**
   * Convert documents from URLs or base64 sources (synchronous)
   */
  convertSource(
    request: ConvertDocumentsRequest
  ): Promise<ConvertDocumentResponse>;

  /**
   * Convert uploaded files (synchronous)
   */
  convertFile(params: FileUploadParams): Promise<ConvertDocumentResponse>;

  /**
   * Convert documents from URLs or base64 sources (asynchronous)
   */
  convertSourceAsync(
    request: ConvertDocumentsRequest
  ): Promise<AsyncConversionTask>;

  /**
   * Convert uploaded files (asynchronous)
   */
  convertFileAsync(params: FileUploadParams): Promise<AsyncConversionTask>;

  /**
   * Poll task status
   */
  pollTaskStatus(taskId: string): Promise<TaskStatusResponse>;

  /**
   * Get task result
   */
  getTaskResult(taskId: string): Promise<ConvertDocumentResponse>;

  /**
   * Get task result as a ZIP file stream
   */
  getTaskResultFile(taskId: string): Promise<ConversionFileResult>;

  // Convenience conversion methods
  /**
   * Convert from URL with progress monitoring
   */
  convertFromUrl(
    url: string,
    options?: ConversionOptions,
    headers?: Record<string, string>
  ): Promise<ConversionResult>;

  /**
   * Convert from file path
   */
  convertFromFile(
    filePath: string,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Convert from buffer
   */
  convertFromBuffer(
    buffer: Buffer,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Convert from base64 string
   */
  convertFromBase64(
    base64String: string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Convert from S3 source
   */
  convertFromS3(
    s3Config: {
      bucket: string;
      key: string;
      region?: string;
      access_key_id?: string;
      secret_access_key?: string;
      session_token?: string;
    },
    options?: ConversionOptions
  ): Promise<ConversionResult>;

  /**
   * Convert with custom target (S3, PUT, etc.)
   */
  convertWithTarget(
    sources: (HttpSource | FileSource | S3Source)[],
    target: ConversionTarget,
    options?: ConversionOptions
  ): Promise<ConversionResult>;
}

/**
 * CLI-specific client interface
 * Extends base with file system and CLI-specific methods
 */
export interface DoclingCLI extends DoclingClientBase {
  /**
   * Watch directory for file changes and auto-convert
   */
  watch(
    directory: string,
    options?: {
      outputDir?: string;
      recursive?: boolean;
      patterns?: string[];
      debounce?: number;
    }
  ): Promise<void>;

  /**
   * Process multiple files in batch
   */
  batch(
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
  }>;

  /**
   * Process directory with options (programmatic, no user interaction)
   */
  processDirectory(
    directoryPath: string,
    options?: ConversionOptions
  ): Promise<{
    success: boolean;
    results: ConversionResult[];
    totalFiles: number;
  }>;

  /**
   * Progress events for CLI operations
   */
  readonly progress: EventEmitter;

  /**
   * Set output directory for CLI operations
   */
  setOutputDir(dir: string): void;

  /**
   * Validate input files
   */
  validateFiles(files: string[]): Promise<{
    valid: string[];
    invalid: Array<{ file: string; reason: string }>;
  }>;
}

/**
 * Conditional type that returns the correct client interface based on config
 */
export type DoclingClient<T extends DoclingConfig> = T extends { api: unknown }
  ? DoclingAPI
  : T extends { cli: unknown }
  ? DoclingCLI
  : DoclingAPI;

/**
 * Type helper for creating strongly typed Docling instances
 */
export type DoclingInstance<T extends DoclingConfig> = DoclingClient<T>;

/**
 * Configuration validation helpers
 */
export function isAPIConfig(
  config: DoclingConfig
): config is Extract<DoclingConfig, { api: unknown }> {
  return "api" in config && config.api !== undefined;
}

export function isCLIConfig(
  config: DoclingConfig
): config is Extract<DoclingConfig, { cli: unknown }> {
  return "cli" in config && config.cli !== undefined;
}
