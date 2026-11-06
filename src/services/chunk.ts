import { loadNodeModule } from "../platform/node-modules";
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
  private static readonly CONTENT_TYPE_BY_EXT: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    html: "text/html",
    htm: "text/html",
    md: "text/markdown",
    txt: "text/plain",
    csv: "text/csv",
    xml: "application/xml",
    json: "application/json",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
  };

  private taskManager: AsyncTaskManager;

  constructor(private http: HttpClient) {
    this.taskManager = new AsyncTaskManager(http);
  }

  async chunkHybridSync(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ChunkDocumentResponse> {
    return this.chunkFile("hybrid", false, file, filename, options);
  }

  async chunkHierarchicalSync(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ChunkDocumentResponse> {
    return this.chunkFile("hierarchical", false, file, filename, options);
  }

  async chunkHybridAsync(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ChunkDocumentResponse> {
    return this.chunkFile("hybrid", true, file, filename, options);
  }

  async chunkHierarchicalAsync(
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions = {}
  ): Promise<ChunkDocumentResponse> {
    return this.chunkFile("hierarchical", true, file, filename, options);
  }

  private async chunkFile(
    kind: "hybrid" | "hierarchical",
    asynchronous: boolean,
    file: Uint8Array | string,
    filename: string,
    options: ConversionOptions
  ): Promise<ChunkDocumentResponse> {
    const fileBuffer = await this.ensureUint8Array(file);
    const response = await this.http.streamUpload<ChunkDocumentResponse | TaskStatusResponse>(
      `/v1/chunk/${kind}/file${asynchronous ? "/async" : ""}`,
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
    if (!asynchronous) return response.data as ChunkDocumentResponse;
    const taskId = (response.data as TaskStatusResponse).task_id;
    if (!taskId) throw new Error("No task ID received from async chunk endpoint");
    this.taskManager.startPollingExistingTask(taskId, {
      timeout: 15 * 60 * 1000,
      pollInterval: 2000,
      maxPolls: 450,
      waitSeconds: 100,
      pollingRetries: 5,
    });
    const result = await this.taskManager.waitForCompletion(taskId);
    if (!result.success) throw new Error(result.error?.message ?? "Chunk task failed");
    return this.getChunkTaskResult(taskId);
  }

  /**
   * Create async chunk task for HybridChunker
   * Returns task object for manual progress tracking
   */
  async chunkHybridFileAsync(params: ChunkFileUploadParams): Promise<AsyncChunkTask> {
    return this.createFileTask("hybrid", params);
  }

  async chunkHierarchicalFileAsync(params: ChunkFileUploadParams): Promise<AsyncChunkTask> {
    return this.createFileTask("hierarchical", params);
  }

  private async createFileTask(
    kind: "hybrid" | "hierarchical",
    params: ChunkFileUploadParams
  ): Promise<AsyncChunkTask> {
    const files = Array.isArray(params.files) ? params.files : [params.files];
    const filenames = Array.isArray(params.filename) ? params.filename : [params.filename];
    const uploadFiles = await Promise.all(
      files.map(async (file, index) => {
        const data = isBinary(file) ? file : new Uint8Array(await file.arrayBuffer());
        const filename = filenames[index] ?? (isBinary(file) ? `document-${index}` : file.name);
        return {
          name: "files",
          data,
          filename,
          contentType: !isBinary(file) && file.type ? file.type : this.getContentType(filename),
          size: data.length,
        };
      })
    );
    const response = await this.http.streamUpload<TaskStatusResponse>(
      `/v1/chunk/${kind}/file/async`,
      uploadFiles,
      this.buildFormFields(params, params.target_type ?? "inbody")
    );
    return this.createAsyncChunkTask(response.data);
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
          if (event !== "error") listener(...args);
          else {
            try {
              void Promise.resolve(listener(...args)).catch((error) => {
                console.error("Error in error callback:", error);
              });
            } catch (error) {
              console.error("Error in error callback:", error);
            }
          }
        }
      },

      poll: async () => {
        const status = await this.pollTaskStatus(taskData.task_id);
        task.status = status.task_status;
        task.emit("progress", status);
        return status;
      },
      waitForCompletion: async () => {
        try {
          const status = await this.waitForTaskCompletion(taskData.task_id);
          task.status = status.task_status;
          task.emit("progress", status);
          return status;
        } catch (error) {
          task.emit("error", { message: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },
      getResult: async () => {
        const result = await this.getChunkTaskResult(taskData.task_id);
        task.emit("complete", result);
        return result;
      },
      cancel: async () => {
        this.taskManager.startPollingExistingTask(taskData.task_id);
        await this.taskManager.cancelTask(taskData.task_id);
      },
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
    this.taskManager.startPollingExistingTask(taskId);
    const result = await this.taskManager.waitForCompletion(taskId);
    if (
      !result.success &&
      result.error?.message !== "Task failure" &&
      result.error?.message !== "Task revoked"
    ) {
      throw new Error(result.error?.message ?? "Chunk task failed");
    }
    return this.pollTaskStatus(taskId);
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
    options: ConversionOptions & { include_converted_doc?: boolean },
    targetType: "inbody" | "zip"
  ): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      target_type: targetType,
    };

    if (options.include_converted_doc !== undefined) {
      fields.include_converted_doc = String(options.include_converted_doc);
    }

    // Add conversion options
    if (options.from_formats) {
      fields.convert_from_formats = options.from_formats;
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
      fields.convert_ocr_lang = options.ocr_lang;
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
      fields.convert_page_range = options.page_range;
    }
    if (options.document_timeout !== undefined) {
      fields.convert_document_timeout = String(options.document_timeout);
    }
    if (options.abort_on_error !== undefined) {
      fields.convert_abort_on_error = String(options.abort_on_error);
    }

    // Additional conversion fields supported by the pinned Serve 1.7.2 chunk forms.
    // Object values become JSON form strings in the HTTP multipart serializer.
    const conversionFields = [
      "do_table_structure",
      "include_images",
      "images_scale",
      "do_code_enrichment",
      "do_formula_enrichment",
      "do_picture_classification",
      "do_picture_description",
      "picture_description_area_threshold",
      "picture_description_local",
      "picture_description_api",
      "md_page_break_placeholder",
      "vlm_pipeline_model",
      "vlm_pipeline_model_local",
      "vlm_pipeline_model_api",
    ] as const;
    for (const key of conversionFields) {
      const value = options[key];
      if (value !== undefined && value !== null) {
        fields[`convert_${key}`] =
          typeof value === "boolean" || typeof value === "number" ? String(value) : value;
      }
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
        const fs = await loadNodeModule("node:fs/promises");
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
    return (ext && ChunkService.CONTENT_TYPE_BY_EXT[ext]) ?? "application/octet-stream";
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
    this.taskManager.destroy();
  }
}
