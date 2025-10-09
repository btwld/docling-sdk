import type { HttpClient } from "../api/http";
import type {
  ConversionFileResult,
  ConversionOptions,
  ConvertDocumentResponse,
  ProcessingError,
  TaskStatusResponse,
} from "../types/api";
import type { NodeReadable } from "../types/streams";
import { AsyncTaskManager } from "./async-task-manager";

/**
 * File service for handling file operations and conversions
 * Provides clean separation of concerns for file-related functionality
 */
export class FileService {
  private taskManager: AsyncTaskManager;

  constructor(private http: HttpClient) {
    this.taskManager = new AsyncTaskManager(http);
  }

  /**
   * Convert document to various formats (text, HTML, markdown, etc.)
   * Uses the SYNC endpoint for fast JSON responses by default
   * For ZIP files, use convertToFile() instead
   */
  async convert(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    return this.convertSync(file, filename, options);
  }

  /**
   * Extract text content from document
   * Uses convert() internally with text format
   */
  async extractText(
    file: Buffer | string,
    filename: string,
    options: Omit<ConversionOptions, "to_formats"> = {}
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, {
      ...options,
      to_formats: ["text"],
    });
  }

  /**
   * Convert document to HTML format
   * Uses convert() internally with HTML format
   */
  async toHtml(
    file: Buffer | string,
    filename: string,
    options: Omit<ConversionOptions, "to_formats"> = {}
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, {
      ...options,
      to_formats: ["html"],
    });
  }

  /**
   * Convert document to Markdown format
   * Uses convert() internally with Markdown format
   */
  async toMarkdown(
    file: Buffer | string,
    filename: string,
    options: Omit<ConversionOptions, "to_formats"> = {}
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, {
      ...options,
      to_formats: ["md"],
    });
  }

  /**
   * Convert document to multiple formats
   * Uses convert() internally with specified formats
   */
  async convertDocument(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, options);
  }

  /**
   * Process document with advanced options
   * Uses convert() internally with processing pipeline
   */
  async process(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    return this.convert(file, filename, {
      pipeline: "vlm",
      ...options,
    });
  }

  /**
   * Convert using ASYNC endpoint (for ZIP files and advanced workflows)
   * Uses AsyncTaskManager with EventEmitter for clean async handling
   * Perfect for ZIP downloads, batch processing, long-running tasks
   */
  async convertAsync(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    try {
      const fileBuffer = await this.ensureBuffer(file);

      const response = await this.http.streamUpload<TaskStatusResponse>(
        "/v1/convert/file/async",
        [
          {
            name: "files",
            data: fileBuffer,
            filename,
            contentType: this.getContentType(filename),
            size: fileBuffer.length,
          },
        ],
        this.buildFormFields(options, "inbody")
      );

      const taskData = response.data;
      const taskId = taskData.task_id;

      // Use centralized task manager for polling
      this.taskManager.startPollingExistingTask(taskId, {
        timeout: 15 * 60 * 1000, // 15 minutes max
        pollInterval: 2000,
        maxPolls: 450, // 15 minutes / 2 seconds
        waitSeconds: 100,
        pollingRetries: 5,
      });

      // Wait for completion using the task manager
      const result = await this.taskManager.waitForCompletion(taskId);

      if (!result.success) {
        throw new Error(result.error?.message || "Task failed");
      }

      // Task completed, get the result
      const resultResponse = await this.http.getJson<ConvertDocumentResponse>(
        `/v1/result/${taskId}`
      );

      return resultResponse.data;
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("Async conversion failed");
    }
  }

  /**
   * Type guard for readable stream
   */
  private isReadableStream(value: unknown): value is NodeReadable {
    return (
      value !== null &&
      typeof value === "object" &&
      "pipe" in value &&
      "read" in value &&
      "readable" in value
    );
  }

  /**
   * Convert document and return as downloadable files (ZIP)
   * Perfect for S3 uploads, file downloads, batch processing
   * Uses async endpoint for proper ZIP file support
   */
  async convertToFile(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionFileResult> {
    return this.convertToFileAsync(file, filename, options);
  }

  /**
   * Convert document using SYNC endpoint (fast JSON responses)
   * Uses the synchronous /v1/convert/file endpoint
   * Perfect for quick JSON responses, text extraction, HTML conversion
   */
  async convertSync(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    const fileBuffer = await this.ensureBuffer(file);

    const response = await this.http.streamUpload<ConvertDocumentResponse>(
      "/v1/convert/file",
      [
        {
          name: "files",
          data: fileBuffer,
          filename,
          contentType: this.getContentType(filename),
          size: fileBuffer.length,
        },
      ],
      this.buildFormFields(options, "inbody")
    );

    return response.data;
  }

  /**
   * Convert document using ASYNC endpoint (ZIP file downloads)
   * Uses AsyncTaskManager with EventEmitter for clean async handling
   * Perfect for ZIP file downloads, batch processing, file storage
   */
  async convertToFileAsync(
    file: Buffer | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionFileResult> {
    try {
      const fileBuffer = await this.ensureBuffer(file);

      const upload = await this.http.streamUpload<ConvertDocumentResponse>(
        "/v1/convert/file/async",
        [
          {
            name: "files",
            data: fileBuffer,
            filename,
            contentType: this.getContentType(filename),
            size: fileBuffer.length,
          },
        ],
        this.buildFormFields(options, "zip")
      );

      const taskId = (upload.data as unknown as { task_id?: string }).task_id;
      if (!taskId) {
        return {
          success: false,
          error: {
            message: "Async upload did not return task_id",
          },
        };
      }

      const result = await this.taskManager.waitForCompletion(taskId);

      if (!result.success) {
        return {
          success: false,
          error: {
            message: result.error?.message || "ZIP task failed",
            details: result.error?.details,
          },
        };
      }

      const resultResponse = await this.http.requestFileStream(
        `/v1/result/${taskId}`,
        {
          headers: { Accept: "application/zip" },
        }
      );

      const contentType = resultResponse.headers["content-type"] || "";

      if (contentType.includes("application/zip")) {
        const contentDisposition =
          resultResponse.headers["content-disposition"] || "";
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
        const zipFilename = filenameMatch
          ? filenameMatch[1]
          : `converted_${filename}.zip`;

        const stream = resultResponse.fileStream || resultResponse.data;

        const result: ConversionFileResult = {
          success: true,
          fileMetadata: {
            contentType,
            filename: zipFilename || "converted.zip",
            ...(resultResponse.headers["content-length"] && {
              size: Number.parseInt(resultResponse.headers["content-length"]),
            }),
          },
        };

        if (this.isReadableStream(stream)) {
          result.fileStream = stream;
        }

        return result;
      }
      return {
        success: false,
        error: {
          message: "Expected ZIP file but received different content type",
          details: { contentType, taskId },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createError(error, "Async ZIP conversion failed"),
      };
    }
  }

  /**
   * Convert input stream to document formats
   * Perfect for NestJS/Express passthrough processing
   */
  async convertStream(
    inputStream: NodeJS.ReadableStream,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ConvertDocumentResponse> {
    const response = await this.http.streamPassthrough(
      "/v1/convert/file",
      inputStream,
      filename,
      this.getContentType(filename),
      this.buildFormFields(options, "inbody"),
      { accept: "json" }
    );

    if (
      response.data &&
      typeof response.data === "object" &&
      "document" in response.data
    ) {
      return response.data as ConvertDocumentResponse;
    }

    throw new Error("No data received from stream conversion");
  }

  /**
   * Convert input stream to downloadable files (ZIP)
   * Perfect for NestJS/Express file proxy
   */
  async convertStreamToFile(
    _inputStream: NodeJS.ReadableStream,
    filename: string,
    options: ConversionOptions
  ): Promise<ConversionFileResult> {
    try {
      const upload = await this.http.streamPassthrough<ConvertDocumentResponse>(
        "/v1/convert/file/async",
        _inputStream,
        filename,
        this.getContentType(filename),
        this.buildFormFields(options, "zip"),
        { accept: "json" }
      );

      if (!upload.data || typeof upload.data !== "object") {
        return {
          success: false,
          error: { message: "Async upload failed", details: upload },
        };
      }

      const taskId = (upload.data as { task_id?: string }).task_id;
      if (!taskId) {
        return {
          success: false,
          error: { message: "Missing task_id from async upload response" },
        };
      }

      // Use centralized task manager for polling
      this.taskManager.startPollingExistingTask(taskId, {
        timeout: 15 * 60 * 1000, // 15 minutes max
        pollInterval: 2000,
        maxPolls: 450, // 15 minutes / 2 seconds
        waitSeconds: 100,
        pollingRetries: 5,
      });

      // Wait for completion using the task manager
      const result = await this.taskManager.waitForCompletion(taskId);

      if (!result.success) {
        return {
          success: false,
          error: { message: result.error?.message || "Task failed" },
        };
      }

      const finalStatus = result.finalStatus;

      if (!finalStatus) {
        return {
          success: false,
          error: { message: "Task polling timeout" },
        };
      }

      if (finalStatus !== "success") {
        return {
          success: false,
          error: { message: `Task failed with status: ${finalStatus}` },
        };
      }

      const fileRes =
        await this.http.requestFileStream<ConvertDocumentResponse>(
          `/v1/result/${taskId}`,
          { method: "GET", headers: { Accept: "application/zip" } }
        );

      if (fileRes.fileStream && fileRes.fileMetadata) {
        return {
          success: true,
          fileStream: fileRes.fileStream,
          fileMetadata: fileRes.fileMetadata,
        };
      }

      return {
        success: false,
        error: {
          message: "Expected ZIP stream but did not receive a file stream",
          details: { headers: fileRes.headers, status: fileRes.status },
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.createError(error, "Stream to ZIP conversion failed"),
      };
    }
  }

  /**
   * Get content type from filename
   */
  private static readonly EXT_CT_MAP: ReadonlyMap<string, string> = new Map([
    ["pdf", "application/pdf"],
    ["doc", "application/msword"],
    [
      "docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["txt", "text/plain"],
    ["md", "text/markdown"],
    ["html", "text/html"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["gif", "image/gif"],
  ]);

  private getContentType(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop();
    return (
      (ext ? FileService.EXT_CT_MAP.get(ext) : undefined) ||
      "application/octet-stream"
    );
  }

  /**
   * Ensure input is a Buffer
   */
  private async ensureBuffer(file: Buffer | string): Promise<Buffer> {
    if (typeof file === "string") {
      const fs = await import("node:fs/promises");
      return fs.readFile(file);
    }
    return file;
  }

  /**
   * Get the async task manager for advanced usage
   * Allows access to EventEmitter for progress tracking, etc.
   */
  getTaskManager(): AsyncTaskManager {
    return this.taskManager;
  }

  /**
   * Clean up resources (call on shutdown)
   */
  destroy(): void {
    this.taskManager.destroy();
  }

  /**
   * Build form fields for API request
   */
  private buildFormFields(
    options: ConversionOptions,
    targetKind?: "inbody" | "zip"
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {};

    if (options.from_formats) fields.from_formats = options.from_formats;
    if (options.to_formats) fields.to_formats = options.to_formats;

    if (options.pipeline) fields.pipeline = options.pipeline;
    if (options.page_range) fields.page_range = options.page_range;

    if (options.do_ocr !== undefined) fields.do_ocr = options.do_ocr.toString();
    if (options.force_ocr !== undefined)
      fields.force_ocr = options.force_ocr.toString();
    if (options.ocr_engine) fields.ocr_engine = options.ocr_engine;
    if (options.ocr_lang) fields.ocr_lang = options.ocr_lang;
    if (options.ocr_options) fields.ocr_options = options.ocr_options;

    // PDF backend
    if (options.pdf_backend) fields.pdf_backend = options.pdf_backend;

    // Table options
    if (options.table_mode) fields.table_mode = options.table_mode;
    if (options.table_cell_matching !== undefined)
      fields.table_cell_matching = options.table_cell_matching.toString();
    if (options.do_table_structure !== undefined)
      fields.do_table_structure = options.do_table_structure.toString();
    if (options.table_structure_options)
      fields.table_structure_options = options.table_structure_options;

    if (options.image_export_mode)
      fields.image_export_mode = options.image_export_mode;
    if (options.include_images !== undefined)
      fields.include_images = options.include_images.toString();
    if (options.images_scale !== undefined)
      fields.images_scale = options.images_scale.toString();
    if (options.generate_page_images !== undefined)
      fields.generate_page_images = options.generate_page_images.toString();
    if (options.generate_picture_images !== undefined)
      fields.generate_picture_images =
        options.generate_picture_images.toString();

    // Enrichment options
    if (options.do_code_enrichment !== undefined)
      fields.do_code_enrichment = options.do_code_enrichment.toString();
    if (options.do_formula_enrichment !== undefined)
      fields.do_formula_enrichment = options.do_formula_enrichment.toString();
    if (options.do_picture_classification !== undefined)
      fields.do_picture_classification =
        options.do_picture_classification.toString();
    if (options.do_picture_description !== undefined)
      fields.do_picture_description = options.do_picture_description.toString();
    if (options.picture_description_area_threshold !== undefined)
      fields.picture_description_area_threshold =
        options.picture_description_area_threshold.toString();
    if (options.picture_description_local)
      fields.picture_description_local = options.picture_description_local;
    if (options.picture_description_api)
      fields.picture_description_api = options.picture_description_api;

    // Other options
    if (options.abort_on_error !== undefined)
      fields.abort_on_error = options.abort_on_error.toString();
    if (options.document_timeout !== undefined)
      fields.document_timeout = options.document_timeout.toString();
    if (options.md_page_break_placeholder)
      fields.md_page_break_placeholder = options.md_page_break_placeholder;
    if (options.create_legacy_output !== undefined)
      fields.create_legacy_output = options.create_legacy_output.toString();
    if (options.force_backend_text !== undefined)
      fields.force_backend_text = options.force_backend_text.toString();

    if (targetKind) {
      fields.target_type = targetKind;
    }

    return fields;
  }

  /**
   * Create standardized error object
   */
  private createError(error: unknown, message: string): ProcessingError {
    return {
      message: error instanceof Error ? error.message : message,
      details: error,
    };
  }
}
