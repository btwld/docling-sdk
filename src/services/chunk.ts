import type { HttpClient } from "../api/http";
import { isBinary, stringToUint8Array } from "../platform/binary";
import type {
  AsyncChunkTask,
  ChunkDocumentResponse,
  ChunkFileUploadParams,
  ConversionOptions,
  HierarchicalChunkerOptionsDocumentsRequest,
  HybridChunkerOptionsDocumentsRequest,
  TaskStatusResponse,
} from "../types/api";
import { AsyncTaskManager } from "./async-task-manager";

/**
 * Chunk service for handling chunking operations
 * Provides clean separation of concerns for chunk-related functionality
 */
export class ChunkService {
  private taskManager: AsyncTaskManager;

  constructor(private http: HttpClient) {
    this.taskManager = new AsyncTaskManager(http);
  }

  /**
   * Chunk document using HybridChunker (SYNC endpoint)
   * Uses the synchronous /v1/chunk/hybrid/file endpoint
   * Perfect for quick JSON responses with chunks
   */
  async chunkHybridSync(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ChunkDocumentResponse> {
    const fileBuffer = await this.ensureUint8Array(file);

    const response = await this.http.streamUpload<ChunkDocumentResponse>(
      "/v1/chunk/hybrid/file",
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
   * Chunk document using HierarchicalChunker (SYNC endpoint)
   * Uses the synchronous /v1/chunk/hierarchical/file endpoint
   * Perfect for quick JSON responses with chunks
   */
  async chunkHierarchicalSync(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ChunkDocumentResponse> {
    const fileBuffer = await this.ensureUint8Array(file);

    const response = await this.http.streamUpload<ChunkDocumentResponse>(
      "/v1/chunk/hierarchical/file",
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
   * Chunk document using HybridChunker (ASYNC endpoint)
   * Uses AsyncTaskManager with EventEmitter for clean async handling
   * Perfect for ZIP downloads, batch processing, long-running tasks
   */
  async chunkHybridAsync(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ChunkDocumentResponse> {
    try {
      const fileBuffer = await this.ensureUint8Array(file);

      const response = await this.http.streamUpload<TaskStatusResponse>(
        "/v1/chunk/hybrid/file/async",
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

      if (!taskId) {
        throw new Error("No task ID received from async chunk endpoint");
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
        throw new Error(result.error?.message || "Chunk task failed");
      }

      // Task completed, get the result
      const resultResponse = await this.http.getJson<ChunkDocumentResponse>(`/v1/result/${taskId}`);

      return resultResponse.data;
    } catch (error) {
      throw error instanceof Error ? error : new Error(`Async chunk failed: ${String(error)}`);
    }
  }

  /**
   * Chunk document using HierarchicalChunker (ASYNC endpoint)
   * Uses AsyncTaskManager with EventEmitter for clean async handling
   * Perfect for ZIP downloads, batch processing, long-running tasks
   */
  async chunkHierarchicalAsync(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ChunkDocumentResponse> {
    try {
      const fileBuffer = await this.ensureUint8Array(file);

      const response = await this.http.streamUpload<TaskStatusResponse>(
        "/v1/chunk/hierarchical/file/async",
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

      if (!taskId) {
        throw new Error("No task ID received from async chunk endpoint");
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
        throw new Error(result.error?.message || "Chunk task failed");
      }

      // Task completed, get the result
      const resultResponse = await this.http.getJson<ChunkDocumentResponse>(`/v1/result/${taskId}`);

      return resultResponse.data;
    } catch (error) {
      throw error instanceof Error ? error : new Error(`Async chunk failed: ${String(error)}`);
    }
  }

  /**
   * Create async chunk task for HybridChunker
   * Returns task object for manual progress tracking
   */
  async chunkHybridFileAsync(params: ChunkFileUploadParams): Promise<AsyncChunkTask> {
    const files = Array.isArray(params.files) ? params.files : [params.files];
    const filenames = Array.isArray(params.filename)
      ? params.filename
      : [params.filename || "document"];

    const uploadFiles = files.map((file, index) => {
      const data = isBinary(file) ? file : stringToUint8Array(file as unknown as string);
      return {
        name: "files",
        data,
        filename: filenames[index] || `document-${index}`,
        contentType: this.getContentType(filenames[index] || "document"),
        size: data.length,
      };
    });

    const response = await this.http.streamUpload<TaskStatusResponse>(
      "/v1/chunk/hybrid/file/async",
      uploadFiles,
      this.buildFormFields(params, params.target_type || "inbody")
    );

    const taskData = response.data;
    return this.createAsyncChunkTask(taskData);
  }

  /**
   * Create async chunk task for HierarchicalChunker
   * Returns task object for manual progress tracking
   */
  async chunkHierarchicalFileAsync(params: ChunkFileUploadParams): Promise<AsyncChunkTask> {
    const files = Array.isArray(params.files) ? params.files : [params.files];
    const filenames = Array.isArray(params.filename)
      ? params.filename
      : [params.filename || "document"];

    const uploadFiles = files.map((file, index) => {
      const data = isBinary(file) ? file : stringToUint8Array(file as unknown as string);
      return {
        name: "files",
        data,
        filename: filenames[index] || `document-${index}`,
        contentType: this.getContentType(filenames[index] || "document"),
        size: data.length,
      };
    });

    const response = await this.http.streamUpload<TaskStatusResponse>(
      "/v1/chunk/hierarchical/file/async",
      uploadFiles,
      this.buildFormFields(params, params.target_type || "inbody")
    );

    const taskData = response.data;
    return this.createAsyncChunkTask(taskData);
  }

  /**
   * Chunk sources using HybridChunker
   */
  async chunkHybridSource(
    request: HybridChunkerOptionsDocumentsRequest
  ): Promise<ChunkDocumentResponse> {
    const response = await this.http.postJson<ChunkDocumentResponse>(
      "/v1/chunk/hybrid/source",
      request
    );
    return response.data;
  }

  /**
   * Chunk sources using HierarchicalChunker
   */
  async chunkHierarchicalSource(
    request: HierarchicalChunkerOptionsDocumentsRequest
  ): Promise<ChunkDocumentResponse> {
    const response = await this.http.postJson<ChunkDocumentResponse>(
      "/v1/chunk/hierarchical/source",
      request
    );
    return response.data;
  }

  /**
   * Chunk sources using HybridChunker (ASYNC)
   */
  async chunkHybridSourceAsync(
    request: HybridChunkerOptionsDocumentsRequest
  ): Promise<AsyncChunkTask> {
    const response = await this.http.postJson<TaskStatusResponse>(
      "/v1/chunk/hybrid/source/async",
      request
    );
    return this.createAsyncChunkTask(response.data);
  }

  /**
   * Chunk sources using HierarchicalChunker (ASYNC)
   */
  async chunkHierarchicalSourceAsync(
    request: HierarchicalChunkerOptionsDocumentsRequest
  ): Promise<AsyncChunkTask> {
    const response = await this.http.postJson<TaskStatusResponse>(
      "/v1/chunk/hierarchical/source/async",
      request
    );
    return this.createAsyncChunkTask(response.data);
  }

  /**
   * Create async chunk task wrapper
   */
  private createAsyncChunkTask(taskData: TaskStatusResponse): AsyncChunkTask {
    if (!taskData.task_id) {
      throw new Error(
        `Invalid task response: missing task_id. Received: ${JSON.stringify(taskData)}`
      );
    }

    // Create a simple event emitter implementation
    const eventListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

    const task = {
      taskId: taskData.task_id,
      status: taskData.task_status,
      position: taskData.task_position,
      meta: taskData.task_meta,

      on(event: string, listener: (...args: unknown[]) => void) {
        if (!eventListeners[event]) {
          eventListeners[event] = [];
        }
        eventListeners[event].push(listener);
        return this;
      },

      emit(event: string, ...args: unknown[]) {
        const listeners = eventListeners[event] || [];
        for (const listener of listeners) {
          listener(...args);
        }
      },

      poll: () => this.pollTaskStatus(taskData.task_id),
      waitForCompletion: () => this.waitForTaskCompletion(taskData.task_id),
      getResult: () => this.getChunkTaskResult(taskData.task_id),
    };

    return task as AsyncChunkTask;
  }

  /**
   * Poll task status
   */
  private async pollTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await this.http.get<TaskStatusResponse>(`/v1/status/poll/${taskId}`);
    return response.data;
  }

  /**
   * Wait for task completion
   */
  private async waitForTaskCompletion(taskId: string): Promise<TaskStatusResponse> {
    // Poll until completion
    let status: TaskStatusResponse;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      status = await this.pollTaskStatus(taskId);
      if (status.task_status === "success" || status.task_status === "failure") {
        break;
      }
      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return status;
  }

  /**
   * Get chunk task result
   */
  private async getChunkTaskResult(taskId: string): Promise<ChunkDocumentResponse> {
    const response = await this.http.get<ChunkDocumentResponse>(`/v1/result/${taskId}`);
    return response.data;
  }

  /**
   * Build form fields for multipart upload
   */
  private buildFormFields(
    options: ConversionOptions,
    targetType: "inbody" | "zip"
  ): Record<string, string> {
    const fields: Record<string, string> = {
      target_type: targetType,
    };

    // Add conversion options
    if (options.from_formats) {
      fields.convert_from_formats = JSON.stringify(options.from_formats);
    }
    if (options.image_export_mode) {
      fields.convert_image_export_mode = options.image_export_mode;
    }
    if (options.do_ocr !== undefined) {
      fields.convert_do_ocr = String(options.do_ocr);
    }
    if (options.force_ocr !== undefined) {
      fields.convert_force_ocr = String(options.force_ocr);
    }
    if (options.ocr_engine) {
      fields.convert_ocr_engine = options.ocr_engine;
    }
    if (options.ocr_lang) {
      fields.convert_ocr_lang = JSON.stringify(options.ocr_lang);
    }
    if (options.pdf_backend) {
      fields.convert_pdf_backend = options.pdf_backend;
    }
    if (options.table_mode) {
      fields.convert_table_mode = options.table_mode;
    }
    if (options.table_cell_matching !== undefined) {
      fields.convert_table_cell_matching = String(options.table_cell_matching);
    }
    if (options.pipeline) {
      fields.convert_pipeline = options.pipeline;
    }
    if (options.page_range) {
      fields.convert_page_range = JSON.stringify(options.page_range);
    }
    if (options.document_timeout !== undefined) {
      fields.convert_document_timeout = String(options.document_timeout);
    }
    if (options.abort_on_error !== undefined) {
      fields.convert_abort_on_error = String(options.abort_on_error);
    }

    // Add chunking-specific options
    if (options.chunking_use_markdown_tables !== undefined) {
      fields.chunking_use_markdown_tables = String(options.chunking_use_markdown_tables);
    }
    if (options.chunking_include_raw_text !== undefined) {
      fields.chunking_include_raw_text = String(options.chunking_include_raw_text);
    }
    if (options.chunking_max_tokens !== undefined && options.chunking_max_tokens !== null) {
      fields.chunking_max_tokens = String(options.chunking_max_tokens);
    }
    if (options.chunking_tokenizer) {
      fields.chunking_tokenizer = options.chunking_tokenizer;
    }
    if (options.chunking_merge_peers !== undefined) {
      fields.chunking_merge_peers = String(options.chunking_merge_peers);
    }

    return fields;
  }

  /**
   * Ensure input is a Uint8Array
   * If string is provided and looks like a file path, reads from file system (Node.js only)
   * Otherwise treats string as UTF-8 content
   */
  private async ensureUint8Array(file: Uint8Array | string): Promise<Uint8Array> {
    if (typeof file === "string") {
      // Check if it looks like a file path (contains path separator or common extensions)
      const looksLikeFilePath =
        file.includes("/") ||
        file.includes("\\") ||
        /\.(pdf|docx?|pptx?|xlsx?|txt|md|html?)$/i.test(file);

      if (looksLikeFilePath) {
        // Dynamic import for Node.js file system
        const fs = await import("node:fs/promises");
        const buffer = await fs.readFile(file);
        return new Uint8Array(buffer);
      }

      // Treat as UTF-8 content
      return stringToUint8Array(file);
    }
    return file;
  }

  /**
   * Get content type based on filename
   */
  private getContentType(filename: string): string {
    const ext = filename.toLowerCase().split(".").pop();
    switch (ext) {
      case "pdf":
        return "application/pdf";
      case "docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      case "pptx":
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      case "xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      case "html":
      case "htm":
        return "text/html";
      case "md":
        return "text/markdown";
      case "txt":
        return "text/plain";
      case "csv":
        return "text/csv";
      case "xml":
        return "application/xml";
      case "json":
        return "application/json";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "gif":
        return "image/gif";
      case "bmp":
        return "image/bmp";
      case "tiff":
      case "tif":
        return "image/tiff";
      default:
        return "application/octet-stream";
    }
  }

  /**
   * Get the async task manager for advanced usage
   * Allows access to EventEmitter for progress tracking, etc.
   */
  getTaskManager(): AsyncTaskManager {
    return this.taskManager;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Clean up any resources if needed
  }
}
