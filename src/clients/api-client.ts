import { readFile } from "node:fs/promises";
import type { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { HttpClient } from "../api/http";
import type { AsyncTaskManager } from "../services/async-task-manager";
import { FileService } from "../services/file";
import { ProgressTracker } from "../services/progress-tracker";
import type {
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
  InputFormat,
  PresignedUrlConvertDocumentResponse,
  S3Source,
  TaskStatusResponse,
} from "../types/api";
import type { DoclingAPI, DoclingAPIConfig } from "../types/client";
import type {
  ProgressConfig,
  ProgressUpdate,
  SafeConversionResult,
  SafeFileConversionResult,
} from "../types/client";
import { tryAsync } from "../utils/result";
import { ValidationUtils } from "../utils/validation";
import {
  type ConnectionState,
  DoclingWebSocketClient,
} from "./websocket-client";

export class DoclingAPIClient implements DoclingAPI {
  public readonly type = "api" as const;
  private http: HttpClient;
  private config: DoclingAPIConfig;
  private ws: DoclingWebSocketClient | null = null;
  private progressManager: ProgressTracker | null = null;
  public readonly files: FileService;

  private static readonly EXT_BY_INPUT: ReadonlyMap<InputFormat, string> =
    new Map<InputFormat, string>([
      ["pdf", ".pdf"],
      ["md", ".md"],
      ["html", ".html"],
      ["docx", ".docx"],
      ["pptx", ".pptx"],
      ["xlsx", ".xlsx"],
      ["image", ".png"],
      ["asciidoc", ".adoc"],
    ]);

  private static readonly CT_BY_INPUT: ReadonlyMap<InputFormat, string> =
    new Map<InputFormat, string>([
      ["pdf", "application/pdf"],
      ["md", "text/markdown"],
      ["html", "text/html"],
      [
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      [
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
      [
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      ["image", "image/png"],
      ["asciidoc", "text/plain"],
    ]);

  constructor(config: DoclingAPIConfig | string) {
    this.config =
      typeof config === "string" ? { type: "api", baseUrl: config } : config;
    const cfg =
      typeof config === "string"
        ? { baseUrl: config }
        : {
            baseUrl: config.baseUrl,
            ...(config.timeout && { timeout: config.timeout }),
            ...(config.retries && { retries: config.retries }),
            ...(config.headers && { headers: config.headers }),
          };
    this.http = new HttpClient(cfg);
    this.files = new FileService(this.http);

    if (typeof config !== "string" && config.progress) {
      this.progressManager = new ProgressTracker(
        this.http,
        config.baseUrl,
        config.progress
      );
    }
  }

  private mergeWithDefaults(options?: ConversionOptions): ConversionOptions {
    return {
      ...this.config.defaultOptions,
      ...(this.config.ocr_engine && {
        ocr_engine: this.config.ocr_engine,
      }),
      ...(this.config.ocr_options && {
        ocr_options: this.config.ocr_options,
      }),
      ...(this.config.pdf_backend && {
        pdf_backend: this.config.pdf_backend,
      }),
      ...(this.config.table_mode && {
        table_mode: this.config.table_mode,
      }),
      ...(this.config.pipeline && {
        pipeline: this.config.pipeline,
      }),
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
    options?: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;
  async convert(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions = {},
    progress?: ProgressConfig
  ): Promise<ConversionResult> {
    if (progress) {
      return this.convertWithAutoProgress(file, filename, options, progress);
    }
    return this.files.convert(file, filename, this.mergeWithDefaults(options));
  }

  /**
   * Extract text content from document
   */
  async extractText(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">
  ): Promise<ConversionResult> {
    return this.files.extractText(file, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Convert document to HTML format
   */
  async toHtml(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;
  async toHtml(
    file: Buffer | string,
    filename: string,
    options: Omit<ConversionOptions, "to_formats"> = {},
    progress?: ProgressConfig
  ): Promise<ConversionResult> {
    if (progress) {
      return this.convertWithAutoProgress(
        file,
        filename,
        { ...options, to_formats: ["html"] },
        progress
      );
    }
    return this.files.toHtml(file, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Convert document to Markdown format
   */
  async toMarkdown(
    file: Buffer | string,
    filename: string,
    options?: Omit<ConversionOptions, "to_formats">,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;
  async toMarkdown(
    file: Buffer | string,
    filename: string,
    options: Omit<ConversionOptions, "to_formats"> = {},
    progress?: ProgressConfig
  ): Promise<ConversionResult> {
    if (progress) {
      return this.convertWithAutoProgress(
        file,
        filename,
        { ...options, to_formats: ["md"] },
        progress
      );
    }
    return this.files.toMarkdown(file, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Convert document to multiple formats
   */
  async convertDocument(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;
  async convertDocument(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionResult> {
    if (progress) {
      return this.convertWithAutoProgress(file, filename, options, progress);
    }
    return this.files.convertDocument(file, filename, {
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
    options?: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionResult>;
  async process(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions = {},
    progress?: ProgressConfig
  ): Promise<ConversionResult> {
    if (progress) {
      return this.convertWithAutoProgress(file, filename, options, progress);
    }
    return this.files.process(file, filename, this.mergeWithDefaults(options));
  }

  /**
   * Convert document and return as downloadable files
   */
  async convertToFile(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionFileResult>;
  async convertToFile(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions,
    progress?: ProgressConfig
  ): Promise<ConversionFileResult> {
    if (progress) {
      return this.convertWithAutoProgress(file, filename, options, progress);
    }
    const mergedOptions = this.mergeWithDefaults(options);
    return this.files.convertToFile(file, filename, {
      ...mergedOptions,
    });
  }

  /**
   * Check API health status
   */
  async health(): Promise<HealthCheckResponse> {
    const response = await this.http.getJson<HealthCheckResponse>("/health");
    return response.data;
  }

  /**
   * Convert documents from URLs or base64 sources (synchronous)
   */
  async convertSource(
    request: ConvertDocumentsRequest
  ): Promise<ConvertDocumentResponse> {
    this.validateConvertRequest(request);

    const response = await this.http.postJson<ConvertDocumentResponse>(
      "/v1/convert/source",
      request
    );
    return response.data;
  }

  /**
   * Convert uploaded files (synchronous)
   */
  async convertFile(
    params: FileUploadParams
  ): Promise<ConvertDocumentResponse> {
    const { files, filename, ...options } = params;

    if (options) {
      ValidationUtils.assertValidConversionOptions(options);
    }

    const fileData = await this.prepareFiles(
      files,
      filename,
      options.from_formats
    );

    const response = await this.http.uploadFiles<ConvertDocumentResponse>(
      "/v1/convert/file",
      fileData,
      { ...options, target_type: "inbody" }
    );

    return response.data;
  }

  /**
   * Convert documents from URLs or base64 sources (asynchronous)
   */
  async convertSourceAsync(
    request: ConvertDocumentsRequest
  ): Promise<AsyncConversionTask> {
    this.validateConvertRequest(request);

    const response = await this.http.postJson<TaskStatusResponse>(
      "/v1/convert/source/async",
      request
    );
    const taskData = response.data;

    return this.createAsyncTask(taskData);
  }

  /**
   * Convert uploaded files (asynchronous)
   * @param progressOverride - Optional progress config to override client config
   */
  async convertFileAsync(
    params: FileUploadParams,
    _progressOverride?: ProgressConfig
  ): Promise<AsyncConversionTask> {
    const { files, filename, ...options } = params;

    if (options) {
      ValidationUtils.assertValidConversionOptions(options);
    }

    const fileData = await this.prepareFiles(
      files,
      filename,
      options.from_formats
    );

    const response = await this.http.uploadFiles<TaskStatusResponse>(
      "/v1/convert/file/async",
      fileData,
      { ...options, target_type: "zip" }
    );

    const taskData = response.data;
    return this.createAsyncTask(taskData);
  }

  /**
   * Poll task status
   */
  async pollTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await this.http.getJson<TaskStatusResponse>(
      `/v1/status/poll/${taskId}`
    );
    return response.data;
  }

  /**
   * Get task result
   */
  async getTaskResult(taskId: string): Promise<ConvertDocumentResponse> {
    const response = await this.http.getJson<ConvertDocumentResponse>(
      `/v1/result/${taskId}`
    );
    return response.data;
  }

  /**
   * Get task result as a ZIP file stream
   */
  async getTaskResultFile(taskId: string): Promise<ConversionFileResult> {
    try {
      const res = await this.http.requestFileStream(`/v1/result/${taskId}`, {
        method: "GET",
        headers: { Accept: "application/zip" },
      });

      const contentType = res.headers["content-type"] || "";
      if (
        res.fileStream &&
        contentType.includes("application/zip") &&
        res.fileMetadata
      ) {
        return {
          success: true,
          fileStream: res.fileStream,
          fileMetadata: res.fileMetadata,
        };
      }

      return {
        success: false,
        error: {
          message: "Expected ZIP file but received different content type",
          details: { headers: res.headers, status: res.status },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message:
            error instanceof Error ? error.message : "ZIP download failed",
          details: error,
        },
      };
    }
  }

  /**
   * Convert using SYNC endpoint (fast JSON responses)
   */
  async convertSync(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    return this.files.convertSync(file, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Convert using ASYNC endpoint (advanced workflows)
   */
  async convertAsync(
    file: Buffer | string,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    return this.files.convertAsync(file, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Convert input stream
   */
  async convertStream(
    inputStream: NodeJS.ReadableStream,
    filename: string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {
    return this.files.convertStream(inputStream, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Convert input stream to ZIP file
   */
  async convertStreamToFile(
    inputStream: NodeJS.ReadableStream,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionFileResult> {
    return this.files.convertStreamToFile(inputStream, filename, {
      ...this.config.defaultOptions,
      ...options,
    });
  }

  /**
   * Get task manager for EventEmitter access
   */
  getTaskManager(): AsyncTaskManager {
    return this.files.getTaskManager();
  }

  /**
   * Convert from URL with progress monitoring
   */
  async convertFromUrl(
    url: string,
    options: ConversionOptions = {},
    headers?: Record<string, string>
  ): Promise<ConversionResult> {
    try {
      const httpSource: HttpSource = { kind: "http", url };
      if (headers) {
        httpSource.headers = headers;
      }

      const request: ConvertDocumentsRequest = {
        options: this.mergeWithDefaults(options),
        sources: [httpSource],
      };

      const result = await this.convertSource(request);
      const normalizedResult = this.normalizeDocumentResponse(
        result,
        options.to_formats?.[0]
      );

      return {
        success: true,
        data: normalizedResult,
      };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Convert from file path
   */
  async convertFromFile(
    filePath: string,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    try {
      const fileBuffer = await readFile(filePath);

      const result = await this.convertFile({
        files: fileBuffer,
        ...this.config.defaultOptions,
        ...options,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Convert from buffer
   */
  async convertFromBuffer(
    buffer: Buffer,
    _filename: string,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    try {
      const result = await this.convertFile({
        files: buffer,
        ...this.config.defaultOptions,
        ...options,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Convert from base64 string
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
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Convert from S3 source
   */
  async convertFromS3(
    s3Config: {
      bucket: string;
      key: string;
      region?: string;
      access_key_id?: string;
      secret_access_key?: string;
      session_token?: string;
      endpoint_url?: string;
    },
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    try {
      const s3Source: S3Source = {
        kind: "s3",
        ...s3Config,
      };

      const request: ConvertDocumentsRequest = {
        options: this.mergeWithDefaults(options),
        sources: [s3Source],
      };

      const result = await this.convertSource(request);
      const normalizedResult = this.normalizeDocumentResponse(
        result,
        options.to_formats?.[0]
      );

      return {
        success: true,
        data: normalizedResult,
      };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Convert with custom target (S3, PUT, etc.)
   */
  async convertWithTarget(
    sources: (HttpSource | FileSource | S3Source)[],
    target: ConversionTarget,
    options: ConversionOptions = {}
  ): Promise<ConversionResult> {
    try {
      const request: ConvertDocumentsRequest = {
        options: this.mergeWithDefaults(options),
        sources,
        target,
      };

      const result = await this.convertSource(request);

      if (target.kind === "put") {
        return {
          success: true,
          data: result satisfies PresignedUrlConvertDocumentResponse as PresignedUrlConvertDocumentResponse,
        };
      }

      const normalizedResult = this.normalizeDocumentResponse(
        result,
        options.to_formats?.[0]
      );

      return {
        success: true,
        data: normalizedResult,
      };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Validate convert request
   */
  private validateConvertRequest(request: ConvertDocumentsRequest): void {
    if (!request.sources || request.sources.length === 0) {
      throw new Error("At least one source must be provided");
    }

    for (const source of request.sources) {
      if (source.kind === "http") {
        try {
          new URL(source.url);
        } catch {
          throw new Error("Invalid URL");
        }
      }
      if (source.kind === "file") {
        if (!source.base64_string || !source.filename) {
          throw new Error("File sources must have base64_string and filename");
        }
      }
    }

    if (request.options) {
      ValidationUtils.assertValidConversionOptions(request.options);
    }
  }

  /**
   * Prepare files for upload
   */
  private async prepareFiles(
    files: File | File[] | Buffer | Buffer[],
    filename?: string | string[],
    fromFormats?: InputFormat[]
  ): Promise<
    Array<{
      name: string;
      data: Buffer;
      filename?: string;
      contentType?: string;
    }>
  > {
    const fileArray = Array.isArray(files) ? files : [files];
    const filenameArray =
      Array.isArray(filename) || filename === undefined
        ? (filename as string[] | undefined)
        : [filename];

    const pickExt = (fmt?: InputFormat): string =>
      (fmt ? DoclingAPIClient.EXT_BY_INPUT.get(fmt) : undefined) ?? "";

    const pickContentType = (fmt?: InputFormat): string =>
      (fmt ? DoclingAPIClient.CT_BY_INPUT.get(fmt) : undefined) ??
      "application/octet-stream";

    const preparedFiles = await Promise.all(
      fileArray.map(async (file, index) => {
        if (Buffer.isBuffer(file)) {
          const fmt = fromFormats?.[0];
          const ext = pickExt(fmt);
          const ct = pickContentType(fmt);
          const nameHint = filenameArray?.[index];
          const finalName = nameHint ?? `document_${index}${ext}`;
          return {
            name: "files",
            data: file,
            filename: finalName,
            contentType: ct,
          };
        }

        if (file && typeof file === "object" && "arrayBuffer" in file) {
          const buffer = Buffer.from(await file.arrayBuffer());
          return {
            name: "files",
            data: buffer,
            filename: (file as File).name,
            contentType: (file as File).type || "application/octet-stream",
          };
        }

        throw new Error(`Unsupported file type at index ${index}`);
      })
    );

    return preparedFiles;
  }

  /**
   * Create async task wrapper
   */
  private createAsyncTask(taskData: TaskStatusResponse): AsyncConversionTask {
    if (!taskData.task_id) {
      throw new Error(
        `Invalid task response: missing task_id. Received: ${JSON.stringify(
          taskData
        )}`
      );
    }

    return {
      taskId: taskData.task_id,
      status: taskData.task_status,
      position: taskData.task_position,
      meta: taskData.task_meta,
      poll: () => this.pollTaskStatus(taskData.task_id),
      waitForCompletion: () => this.waitForTaskCompletion(taskData.task_id),
      getResult: () => this.getTaskResult(taskData.task_id),
    } as AsyncConversionTask;
  }

  /**
   * Wait for task completion by polling status until terminal state
   */
  private async waitForTaskCompletion(
    taskId: string
  ): Promise<TaskStatusResponse> {
    const maxMs = 15 * 60 * 1000;
    const intervalMs = 2000;
    const start = Date.now();

    while (Date.now() - start < maxMs) {
      const status = await this.pollTaskStatus(taskId);
      if (
        status.task_status === "success" ||
        status.task_status === "failure"
      ) {
        return status;
      }

      await delay(intervalMs);
    }

    return this.pollTaskStatus(taskId);
  }

  /**
   * Normalize document response
   */
  private normalizeDocumentResponse(
    response: ConvertDocumentResponse,
    _format?: string
  ): ConvertDocumentResponse {
    return response;
  }

  /**
   * Normalize error for consistent error handling
   */
  private normalizeError(error: unknown): {
    message: string;
    code?: string;
    details?: unknown;
  } {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in (error as Record<string, unknown>)
    ) {
      const err = error as Record<string, unknown>;
      return {
        message:
          typeof err.message === "string" ? err.message : "Network error",
        code: "NETWORK_ERROR",
        details:
          "response" in err
            ? err.response
            : "details" in err
            ? err.details
            : err,
      };
    }

    if (error instanceof Error) {
      return {
        message: error.message,
        code: error.name || "Error",
        details: error,
      };
    }

    return {
      message: String(error),
      code: "UNKNOWN_ERROR",
      details: error,
    };
  }

  /**
   * Convert with automatic hybrid progress tracking
   * Uses the progress config from constructor to automatically track progress
   * @param progressOverride - Optional progress config to override client config
   */
  async convertWithAutoProgress(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions = {},
    progressOverride?: ProgressConfig
  ): Promise<ConversionResult> {
    const progressManager = progressOverride
      ? new ProgressTracker(this.http, this.config.baseUrl, progressOverride)
      : this.progressManager;

    if (!progressManager) {
      return this.convertFromBuffer(
        typeof file === "string" ? Buffer.from(file) : file,
        filename,
        options
      );
    }

    try {
      const task = await this.convertFileAsync({
        files: typeof file === "string" ? Buffer.from(file) : file,
        ...this.config.defaultOptions,
        ...options,
      });

      await progressManager.startTracking(task.taskId);

      return new Promise((resolve, reject) => {
        progressManager.on("progress", (progress: ProgressUpdate) => {
          if (progress.stage === "completed" && progress.status === "success") {
            progressManager.stopTracking().then(() => {
              this.getTaskResult(task.taskId)
                .then((result) => {
                  resolve({
                    success: true,
                    data: result,
                    taskId: task.taskId,
                  });
                })
                .catch(reject);
            });
          } else if (progress.status === "failure") {
            progressManager.stopTracking().then(() => {
              reject(new Error(`Task failed: ${progress.message}`));
            });
          }
        });
      });
    } catch (error) {
      if (progressManager) {
        await progressManager.stopTracking();
      }
      return {
        success: false,
        error: {
          message: "Auto progress conversion failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Convert to stream (API version of CLI convertToStream())
   * Streams the result directly to output stream
   * @param returnAsZip - If true, returns ZIP file; if false, returns content directly
   */
  async convertToStream(
    file: Buffer | string,
    filename: string,
    outputStream: Writable,
    options: ConversionOptions = {},
    returnAsZip = false
  ): Promise<{
    success: boolean;
    error?: { message: string; details?: string };
  }> {
    try {
      const request = this.createStreamRequest(
        file,
        filename,
        options,
        returnAsZip
      );
      return await this.executeStreamRequest(
        request,
        outputStream,
        returnAsZip
      );
    } catch (error) {
      return this.createStreamError("Failed to stream conversion", error);
    }
  }

  /**
   * Create stream request with proper structure
   */
  private createStreamRequest(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions,
    returnAsZip: boolean
  ): ConvertDocumentsRequest {
    const fileBuffer = typeof file === "string" ? Buffer.from(file) : file;
    const base64Content = fileBuffer.toString("base64");

    return {
      options: { ...this.config.defaultOptions, ...options },
      target: { kind: returnAsZip ? "zip" : "inbody" },
      sources: [{ kind: "file", filename, base64_string: base64Content }],
    };
  }

  /**
   * Execute stream request using Map-based dispatch
   */
  private async executeStreamRequest(
    request: ConvertDocumentsRequest,
    outputStream: Writable,
    returnAsZip: boolean
  ): Promise<{
    success: boolean;
    error?: { message: string; details?: string };
  }> {
    const streamExecutors = new Map([
      ["zip", () => this.executeZipStreamRequest(request, outputStream)],
      [
        "content",
        () => this.executeContentStreamRequest(request, outputStream),
      ],
    ]);

    const executorKey = returnAsZip ? "zip" : "content";
    const executor = streamExecutors.get(executorKey);
    if (!executor) {
      throw new Error(`Unknown stream executor: ${executorKey}`);
    }
    return await executor();
  }

  /**
   * Execute ZIP stream request
   */
  private async executeZipStreamRequest(
    request: ConvertDocumentsRequest,
    outputStream: Writable
  ): Promise<{
    success: boolean;
    error?: { message: string; details?: string };
  }> {
    const primary = await this.http.requestFileStream("/v1/convert/source", {
      method: "POST",
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/zip",
      },
    });

    if (primary.fileStream && primary.status === 200) {
      return await this.handleFileStreamResponse(
        primary.fileStream,
        outputStream
      );
    }

    try {
      const task = await this.convertSourceAsync(request);
      await task.waitForCompletion();

      const result = await this.http.requestFileStream(
        `/v1/result/${task.taskId}`,
        {
          method: "GET",
          headers: { Accept: "application/zip" },
        }
      );

      if (result.fileStream && result.status === 200) {
        return await this.handleFileStreamResponse(
          result.fileStream,
          outputStream
        );
      }

      return await this.handleEmptyStreamResponse(outputStream);
    } catch (error) {
      return this.createStreamError("ZIP streaming failed", error);
    }
  }

  /**
   * Type guard for readable stream
   */
  private isReadableStream(value: unknown): value is NodeJS.ReadableStream {
    return (
      value !== null &&
      typeof value === "object" &&
      "pipe" in value &&
      "read" in value &&
      "readable" in value
    );
  }

  /**
   * Execute content stream request
   */
  private async executeContentStreamRequest(
    request: ConvertDocumentsRequest,
    outputStream: Writable
  ): Promise<{
    success: boolean;
    error?: { message: string; details?: string };
  }> {
    const response = await this.http.requestJson<unknown>(
      "/v1/convert/source",
      {
        method: "POST",
        body: JSON.stringify(request),
      }
    );

    if (this.isReadableStream(response.data)) {
      return this.handleFileStreamResponse(
        response.data as NodeJS.ReadableStream,
        outputStream
      );
    }

    return this.handleDataStreamResponse(
      response.data as unknown,
      outputStream
    );
  }

  /**
   * Create standardized stream error response
   */
  private createStreamError(
    message: string,
    error: unknown
  ): { success: boolean; error: { message: string; details?: string } } {
    return {
      success: false,
      error: {
        message,
        details: error instanceof Error ? error.message : String(error),
      },
    };
  }

  /**
   * Create progress wrapper for multiple file processing
   */
  private createProgressWrapper(
    index: number,
    totalFiles: number,
    filename: string,
    onProgress?: (progress: {
      stage: string;
      currentFile: number;
      totalFiles: number;
      filename: string;
      percentage?: number;
      message?: string;
      uploadedBytes?: number;
      totalBytes?: number;
    }) => void
  ) {
    return (pipelineProgress: {
      stage?: string;
      percentage?: number;
      message?: string;
      uploadedBytes?: number;
      totalBytes?: number;
      bytesPerSecond?: number;
    }) => {
      if (onProgress) {
        onProgress({
          stage: pipelineProgress.stage || "uploading",
          currentFile: index + 1,
          totalFiles,
          filename,
          ...(pipelineProgress.percentage !== undefined && {
            percentage: pipelineProgress.percentage,
          }),
          ...(pipelineProgress.message && {
            message: pipelineProgress.message,
          }),
          ...(pipelineProgress.uploadedBytes !== undefined && {
            uploadedBytes: pipelineProgress.uploadedBytes,
          }),
          ...(pipelineProgress.totalBytes !== undefined && {
            totalBytes: pipelineProgress.totalBytes,
          }),
        });
      }
    };
  }

  /**
   * Recursive polling method for task status
   */
  private async pollRecursively(
    taskId: string,
    pollCount: number,
    maxPolls: number,
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      conversionProgress?: number;
      message?: string;
    }) => void
  ): Promise<TaskStatusResponse> {
    const status = await this.pollTaskStatus(taskId);

    if (onProgress && pollCount > 0) {
      const progress = Math.min(90, 30 + (pollCount / maxPolls) * 60);
      onProgress({
        stage: "processing",
        percentage: progress,
        conversionProgress: progress,
        message: `Processing... ${Math.round(progress)}%`,
      });
    }

    const isStillProcessing =
      status.task_status === "pending" || status.task_status === "started";
    const hasMorePolls = pollCount < maxPolls;

    if (isStillProcessing && hasMorePolls) {
      const { setTimeout } = await import("node:timers/promises");
      await setTimeout(5000);
      return this.pollRecursively(taskId, pollCount + 1, maxPolls, onProgress);
    }

    return status;
  }

  /**
   * Reusable input type converter using Map-based approach
   * Eliminates if/else chains across multiple methods
   */
  private async convertInputByType(
    file: {
      buffer?: Buffer;
      filePath?: string;
      stream?: NodeJS.ReadableStream;
      filename: string;
      size?: number;
    },
    options: ConversionOptions,
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      uploadedBytes?: number;
      totalBytes?: number;
      bytesPerSecond?: number;
    }) => void
  ): Promise<ConversionResult> {
    const inputType = file.stream
      ? "stream"
      : file.filePath
      ? "filePath"
      : file.buffer
      ? "buffer"
      : null;

    if (!inputType) {
      throw new Error("Either buffer, filePath, or stream must be provided");
    }

    const conversionHandlers = new Map([
      [
        "stream",
        () => {
          if (!file.stream) {
            throw new Error("Stream is required for stream conversion");
          }
          return this.convertStreamWithPipeline(
            file.stream,
            file.filename,
            options,
            file.size,
            onProgress
          );
        },
      ],
      [
        "filePath",
        () => {
          if (!file.filePath) {
            throw new Error("File path is required for file conversion");
          }
          return this.convertFileWithPipeline(
            file.filePath,
            options,
            onProgress
          );
        },
      ],
      [
        "buffer",
        () => {
          if (!file.buffer) {
            throw new Error("Buffer is required for buffer conversion");
          }
          return this.convertFromBuffer(file.buffer, file.filename, options);
        },
      ],
    ]);

    const handler = conversionHandlers.get(inputType);
    if (!handler) {
      throw new Error(`Unknown conversion handler: ${inputType}`);
    }
    return await handler();
  }

  /**
   * Handle file stream response for streaming
   */
  private async handleFileStreamResponse(
    fileStream: NodeJS.ReadableStream,
    outputStream: Writable
  ): Promise<{
    success: boolean;
    error?: { message: string; details?: string };
  }> {
    return new Promise((resolve) => {
      fileStream.on("error", (error: Error) => {
        resolve({
          success: false,
          error: {
            message: "Stream error",
            details: error.message,
          },
        });
      });

      fileStream.on("end", () => {
        outputStream.end();
        resolve({ success: true });
      });

      fileStream.pipe(outputStream, { end: false });
    });
  }

  /**
   * Handle data response for streaming
   * Extracts content from API response structure
   */
  private async handleDataStreamResponse(
    data: unknown,
    outputStream: Writable
  ): Promise<{ success: boolean }> {
    let content: string;

    if (data && typeof data === "object" && "document" in data) {
      const document = (
        data as {
          document: {
            md_content?: string;
            html_content?: string;
            text_content?: string;
          };
        }
      ).document;

      const contentExtractors = new Map([
        ["md_content", () => document.md_content || ""],
        ["html_content", () => document.html_content || ""],
        ["text_content", () => document.text_content || ""],
        ["default", () => JSON.stringify(document, null, 2)],
      ]);

      const contentType = document.md_content
        ? "md_content"
        : document.html_content
        ? "html_content"
        : document.text_content
        ? "text_content"
        : "default";

      const extractor = contentExtractors.get(contentType);
      if (!extractor) {
        throw new Error(`Unknown content extractor: ${contentType}`);
      }
      content = extractor();
    } else if (typeof data === "string") {
      content = data;
    } else {
      content = JSON.stringify(data, null, 2);
    }

    outputStream.write(content);
    outputStream.end();
    return { success: true };
  }

  /**
   * Handle empty response case for streaming
   */
  private async handleEmptyStreamResponse(outputStream: Writable): Promise<{
    success: boolean;
    error: { message: string; details: string };
  }> {
    outputStream.end();
    return {
      success: false,
      error: {
        message: "No stream or data received from API",
        details: "Response did not contain expected file stream or data",
      },
    };
  }

  /**
   * Convert with progress monitoring (API version of CLI convertWithProgress())
   * Enhanced progress monitoring for API uploads and conversions
   */
  async convertWithProgress(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions = {},
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      uploadProgress?: number;
      conversionProgress?: number;
    }) => void
  ): Promise<ConversionResult> {
    try {
      if (onProgress) {
        onProgress({
          stage: "preparing",
          message: "Preparing file for upload",
        });
      }

      if (Buffer.isBuffer(file) && file.length > 10 * 1024 * 1024) {
        return this.convertWithAsyncProgress(
          file,
          filename,
          options,
          onProgress
        );
      }

      if (onProgress) {
        onProgress({
          stage: "uploading",
          percentage: 0,
          message: "Starting upload",
        });
      }

      const uploadProgressInterval = setInterval(() => {
        if (onProgress) {
          const progress = Math.min(90, Math.random() * 90);
          onProgress({
            stage: "uploading",
            percentage: progress,
            uploadProgress: progress,
            message: `Uploading... ${Math.round(progress)}%`,
          });
        }
      }, 100);

      try {
        const result = await this.convert(file, filename, options);

        clearInterval(uploadProgressInterval);

        if (onProgress) {
          onProgress({
            stage: "completed",
            percentage: 100,
            message: "Conversion completed",
          });
        }

        return result;
      } finally {
        clearInterval(uploadProgressInterval);
      }
    } catch (error) {
      if (onProgress) {
        onProgress({
          stage: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        success: false,
        error: {
          message: "Conversion with progress failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Validate files (API version of CLI validateFiles())
   * Validates files before processing
   */
  async validateFiles(
    files: Array<{ buffer?: Buffer; filePath?: string; filename: string }>
  ): Promise<{
    valid: boolean;
    results: Array<{
      filename: string;
      valid: boolean;
      errors?: string[];
      warnings?: string[];
    }>;
  }> {
    const results = files.map((file) => {
      const errors: string[] = [];
      const warnings: string[] = [];

      if (!file.filename) {
        errors.push("Filename is required");
      }

      if (!file.buffer && !file.filePath) {
        errors.push("Either buffer or filePath must be provided");
      }

      if (file.buffer) {
        if (file.buffer.length === 0) {
          errors.push("File is empty");
        } else if (file.buffer.length > 100 * 1024 * 1024) {
          warnings.push(
            "File is very large and may take a long time to process"
          );
        }
      }

      const ext = file.filename.split(".").pop()?.toLowerCase();
      const supportedExtensions = ["pdf", "docx", "pptx", "html", "md", "txt"];
      if (ext && !supportedExtensions.includes(ext)) {
        warnings.push(`File extension '${ext}' may not be fully supported`);
      }

      return {
        filename: file.filename,
        valid: errors.length === 0,
        ...(errors.length > 0 && { errors }),
        ...(warnings.length > 0 && { warnings }),
      };
    });

    return {
      valid: results.every((r) => r.valid),
      results,
    };
  }

  /**
   * WebSocket Real-time Features (LOW IMPACT Advanced)
   */

  /**
   * Convert with WebSocket real-time updates
   */
  async convertWithWebSocket(
    request: ConvertDocumentsRequest,
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      taskId: string;
      position?: number;
      status: string;
      timestamp: number;
    }) => void
  ): Promise<ConversionResult> {
    try {
      if (!this.ws) {
        this.ws = new DoclingWebSocketClient({
          baseUrl: this.config.baseUrl,
          timeout: this.config.timeout || 30000,
          reconnectAttempts: 3,
          reconnectDelay: 5000,
          heartbeatInterval: 30000,
        });
      }

      const task = await this.convertSourceAsync(request);

      await this.ws.connectToTask(task.taskId);

      if (onProgress) {
        this.ws.on("progress", (progress) => {
          onProgress({
            stage: progress.stage || "processing",
            percentage: progress.percentage,
            message: progress.message || `Processing task ${task.taskId}`,
            taskId: task.taskId,
            position: progress.position,
            status: progress.status || "processing",
            timestamp: Date.now(),
          });
        });

        this.ws.on("status", (status, taskId) => {
          onProgress({
            stage: status === "success" ? "completed" : status,
            ...(status === "success" && { percentage: 100 }),
            message: `Task ${status}`,
            taskId,
            status,
            timestamp: Date.now(),
          });
        });
      }

      const finalStatus = await this.ws.monitorTask(task.taskId);

      if (finalStatus.task_status === "success") {
        const finalResult = await this.getTaskResult(task.taskId);
        return {
          success: true,
          data: finalResult,
          taskId: task.taskId,
        };
      }
      throw new Error(
        `WebSocket conversion failed with status: ${finalStatus.task_status}`
      );
    } catch (error) {
      return {
        success: false,
        error: {
          message: "WebSocket conversion failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Convert file with WebSocket real-time updates
   */
  async convertFileWithWebSocket(
    buffer: Buffer,
    filename: string,
    options: ConversionOptions = {},
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      taskId: string;
      position?: number;
      status: string;
      timestamp: number;
      uploadedBytes?: number;
      totalBytes?: number;
    }) => void
  ): Promise<ConversionResult> {
    try {
      const totalBytes = buffer.length;

      if (onProgress) {
        onProgress({
          stage: "uploading",
          percentage: 0,
          message: "Starting file upload...",
          taskId: "upload",
          status: "uploading",
          timestamp: Date.now(),
          uploadedBytes: 0,
          totalBytes,
        });
      }

      if (!this.ws) {
        this.ws = new DoclingWebSocketClient({
          baseUrl: this.config.baseUrl,
          timeout: this.config.timeout || 30000,
          reconnectAttempts: 3,
          reconnectDelay: 5000,
          heartbeatInterval: 30000,
        });
      }

      const task = await this.convertFileAsync({
        files: buffer,
        ...this.config.defaultOptions,
        ...options,
      });

      if (onProgress) {
        onProgress({
          stage: "uploaded",
          percentage: 100,
          message: "File uploaded, starting conversion...",
          taskId: task.taskId,
          status: "processing",
          timestamp: Date.now(),
          uploadedBytes: totalBytes,
          totalBytes,
        });
      }

      await this.ws.connectToTask(task.taskId);

      if (onProgress) {
        this.ws.on("progress", (progress) => {
          onProgress({
            stage: progress.stage || "processing",
            percentage: progress.percentage,
            message: progress.message || `Processing ${filename}`,
            taskId: task.taskId,
            position: progress.position,
            status: progress.status || "processing",
            timestamp: Date.now(),
            uploadedBytes: totalBytes,
            totalBytes,
          });
        });

        this.ws.on("status", (status, taskId) => {
          onProgress({
            stage: status === "success" ? "completed" : status,
            ...(status === "success" && { percentage: 100 }),
            message: `File conversion ${status}`,
            taskId,
            status,
            timestamp: Date.now(),
            uploadedBytes: totalBytes,
            totalBytes,
          });
        });
      }

      const finalStatus = await this.ws.monitorTask(task.taskId);

      if (finalStatus.task_status === "success") {
        const finalResult = await this.getTaskResult(task.taskId);
        return {
          success: true,
          data: finalResult,
          taskId: task.taskId,
        };
      }
      throw new Error(
        `WebSocket file conversion failed with status: ${finalStatus.task_status}`
      );
    } catch (error) {
      return {
        success: false,
        error: {
          message: "WebSocket file conversion failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Get WebSocket connection state
   */
  getWebSocketState(): ConnectionState {
    return this.ws?.getConnectionState() || "disconnected";
  }

  /**
   * Convert file with pipeline-based upload
   * Uses Node.js native HTTP streaming for maximum efficiency
   */
  async convertFileWithPipeline(
    filePath: string,
    options: ConversionOptions = {},
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      uploadedBytes?: number;
      totalBytes?: number;
      bytesPerSecond?: number;
    }) => void
  ): Promise<ConversionResult> {
    try {
      const result = await this.http.uploadFileStream<ConvertDocumentResponse>(
        "/v1/convert/file",
        filePath,
        "files",
        {
          ...this.config.defaultOptions,
          ...options,
        },
        {
          onProgress: (pipelineProgress) => {
            if (onProgress) {
              onProgress({
                stage: pipelineProgress.stage,
                percentage: pipelineProgress.percentage,
                message: `Pipeline ${pipelineProgress.stage}: ${filePath
                  .split("/")
                  .pop()}`,
                uploadedBytes: pipelineProgress.uploadedBytes,
                totalBytes: pipelineProgress.totalBytes,
                bytesPerSecond: pipelineProgress.bytesPerSecond,
              });
            }
          },
        }
      );

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: "Pipeline file conversion failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Convert stream with pipeline-based upload
   * Perfect for true passthrough streaming from APIs
   */
  async convertStreamWithPipeline(
    stream: NodeJS.ReadableStream,
    filename: string,
    options: ConversionOptions = {},
    size?: number,
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      uploadedBytes?: number;
      totalBytes?: number;
      bytesPerSecond?: number;
    }) => void
  ): Promise<ConversionResult> {
    try {
      const streamData = {
        name: "files",
        stream,
        filename,
        contentType: this.getContentType(filename),
        ...(size !== undefined && { size }),
      };

      const result = await this.http.pipelineUpload<ConvertDocumentResponse>(
        "/v1/convert/file",
        streamData,
        {
          ...this.config.defaultOptions,
          ...options,
        },
        {
          onProgress: (pipelineProgress) => {
            if (onProgress) {
              onProgress({
                stage: pipelineProgress.stage,
                percentage: pipelineProgress.percentage,
                message: `Pipeline ${pipelineProgress.stage}: ${filename}`,
                uploadedBytes: pipelineProgress.uploadedBytes,
                totalBytes: pipelineProgress.totalBytes,
                bytesPerSecond: pipelineProgress.bytesPerSecond,
              });
            }
          },
        }
      );

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: "Pipeline stream conversion failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Direct streaming conversion
   * Uses true passthrough streaming without intermediate buffering
   */
  async convertStreamDirect(
    inputStream: NodeJS.ReadableStream,
    filename: string,
    contentType: string,
    options: ConversionOptions = {},
    estimatedSize?: number,
    onProgress?: (progress: {
      uploadedBytes: number;
      totalBytes: number;
      percentage: number;
      bytesPerSecond: number;
      stage: "preparing" | "uploading" | "processing" | "completed";
    }) => void
  ): Promise<ConversionResult> {
    try {
      const streamOptions = {
        ...(onProgress && { onProgress }),
        ...(estimatedSize !== undefined && { estimatedSize }),
      };

      const result = await this.http.streamPassthrough<ConvertDocumentResponse>(
        "/v1/convert/file",
        inputStream,
        filename,
        contentType,
        {
          ...this.config.defaultOptions,
          ...options,
        },
        streamOptions
      );

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: "Direct stream conversion failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Enhanced batch processing with pipeline uploads
   * Processes multiple files with advanced streaming techniques
   */
  async convertMultipleFiles(
    files: Array<{
      buffer?: Buffer;
      filePath?: string;
      stream?: NodeJS.ReadableStream;
      filename: string;
      size?: number;
    }>,
    options: ConversionOptions = {},
    onProgress?: (progress: {
      stage: string;
      currentFile: number;
      totalFiles: number;
      filename: string;
      percentage?: number;
      message?: string;
      uploadedBytes?: number;
      totalBytes?: number;
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
    const conversionPromises = files
      .filter((file) => file)
      .map(async (file, index) => {
        const percentage = Math.round(((index + 1) / files.length) * 100);

        if (onProgress) {
          onProgress({
            stage: "processing",
            currentFile: index + 1,
            totalFiles: files.length,
            filename: file.filename,
            percentage,
          });
        }

        const progressWrapper = this.createProgressWrapper(
          index,
          files.length,
          file.filename,
          onProgress
        );

        try {
          const result = await this.convertInputByType(
            file,
            options,
            progressWrapper
          );
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
      });

    const settledResults = await Promise.allSettled(conversionPromises);

    const results = settledResults.map((settled) =>
      settled.status === "fulfilled"
        ? settled.value
        : {
            filename: "unknown",
            success: false,
            error:
              settled.reason instanceof Error
                ? settled.reason.message
                : String(settled.reason),
          }
    );

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
   * Get content type from filename
   */
  private static readonly EXT_CT_MAP: ReadonlyMap<string, string> = new Map([
    ["pdf", "application/pdf"],
    [
      "docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    [
      "xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["html", "text/html"],
    ["md", "text/markdown"],
    ["txt", "text/plain"],
  ]);

  private getContentType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    return (
      (ext ? DoclingAPIClient.EXT_CT_MAP.get(ext) : undefined) ||
      "application/octet-stream"
    );
  }

  /**
   * Convert with async progress monitoring for large files
   */
  private async convertWithAsyncProgress(
    file: Buffer,
    _filename: string,
    options: ConversionOptions,
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      uploadProgress?: number;
      conversionProgress?: number;
    }) => void
  ): Promise<ConversionResult> {
    try {
      if (onProgress) {
        onProgress({
          stage: "uploading",
          percentage: 10,
          message: "Starting async conversion for large file",
        });
      }

      const task = await this.convertFileAsync({
        files: file,
        ...this.config.defaultOptions,
        ...options,
      });

      if (onProgress) {
        onProgress({
          stage: "processing",
          percentage: 30,
          message: "File uploaded, processing started",
        });
      }

      const maxPolls = 60;
      const status = await this.pollRecursively(
        task.taskId,
        0,
        maxPolls,
        onProgress
      );

      if (status.task_status === "success") {
        const result = await this.getTaskResult(task.taskId);

        if (onProgress) {
          onProgress({
            stage: "completed",
            percentage: 100,
            message: "Async conversion completed",
          });
        }

        return {
          success: true,
          data: result,
        };
      }
      throw new Error(`Task failed with status: ${status.task_status}`);
    } catch (error) {
      return {
        success: false,
        error: {
          message: "Async conversion failed",
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
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
   * Utility Methods
   */

  /**
   * Get the HTTP client for advanced usage
   */
  getHttpClient(): HttpClient {
    return this.http;
  }

  /**
   * Get the current configuration
   */
  getConfig(): DoclingAPIConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<DoclingAPIConfig>): void {
    this.config = { ...this.config, ...updates };

    if (
      updates.baseUrl ||
      updates.timeout ||
      updates.retries ||
      updates.headers
    ) {
      this.http = new HttpClient({
        baseUrl: this.config.baseUrl,
        ...(this.config.timeout && { timeout: this.config.timeout }),
        ...(this.config.retries && { retries: this.config.retries }),
        ...(this.config.headers && { headers: this.config.headers }),
      });

      this.files.destroy();

      Object.defineProperty(this, "files", {
        value: new FileService(this.http),
        writable: false,
        enumerable: true,
        configurable: true,
      });
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.files.destroy();
  }
}
