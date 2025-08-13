import { z } from "zod";

/**
 * Core Docling enum schemas with custom error messages
 */
export const InputFormatSchema = z.enum(
  [
    "pdf",
    "docx",
    "pptx",
    "html",
    "image",
    "csv",
    "xlsx",
    "asciidoc",
    "md",
    "xml_uspto",
    "xml_jats",
    "json_docling",
    "audio",
  ],
  {
    error:
      "Invalid input format. Supported formats: pdf, docx, pptx, html, image, csv, xlsx, asciidoc, md, xml_uspto, xml_jats, json_docling, audio",
  }
);

export const OutputFormatSchema = z.enum(
  ["md", "json", "html", "html_split_page", "text", "doctags"],
  {
    error:
      "Invalid output format. Supported formats: md, json, html, html_split_page, text, doctags",
  }
);

export const OcrEngineSchema = z.enum(
  ["easyocr", "tesserocr", "tesseract", "rapidocr", "ocrmac"],
  {
    error:
      "Invalid OCR engine. Supported engines: easyocr, tesserocr, tesseract, rapidocr, ocrmac",
  }
);

export const AcceleratorDeviceSchema = z.enum(["auto", "cpu", "cuda", "mps"], {
  error: "Invalid accelerator device. Supported devices: auto, cpu, cuda, mps",
});

export const AcceleratorOptionsSchema = z
  .object({
    device: AcceleratorDeviceSchema.optional(),
    num_threads: z.number().positive().optional(),
  })
  .optional();

export const LayoutOptionsSchema = z
  .object({
    create_orphan_clusters: z.boolean().optional(),
    keep_empty_clusters: z.boolean().optional(),
    model_spec: z.string().optional(),
  })
  .optional();

export const BaseOcrOptionsSchema = z.object({
  kind: OcrEngineSchema,
  lang: z.array(z.string()),
  force_full_page_ocr: z.boolean().optional(),
  bitmap_area_threshold: z.number().min(0).max(1).optional(),
});

export const EasyOcrOptionsSchema = BaseOcrOptionsSchema.extend({
  kind: z.literal("easyocr"),
  use_gpu: z.boolean().optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  model_storage_directory: z.string().optional(),
  recog_network: z.string().optional(),
  download_enabled: z.boolean().optional(),
});

export const RapidOcrOptionsSchema = BaseOcrOptionsSchema.extend({
  kind: z.literal("rapidocr"),
  text_score: z.number().min(0).max(1).optional(),
  use_det: z.boolean().optional(),
  use_cls: z.boolean().optional(),
  use_rec: z.boolean().optional(),
  print_verbose: z.boolean().optional(),
  det_model_path: z.string().optional(),
  cls_model_path: z.string().optional(),
  rec_model_path: z.string().optional(),
  rec_keys_path: z.string().optional(),
});

export const TesseractCliOcrOptionsSchema = BaseOcrOptionsSchema.extend({
  kind: z.literal("tesseract"),
  tesseract_cmd: z.string().optional(),
  path: z.string().optional(),
});

export const TesseractOcrOptionsSchema = BaseOcrOptionsSchema.extend({
  kind: z.literal("tesserocr"),
  path: z.string().optional(),
});

export const OcrMacOptionsSchema = BaseOcrOptionsSchema.extend({
  kind: z.literal("ocrmac"),
  recognition: z.string().optional(),
  framework: z.string().optional(),
});

export const OcrOptionsSchema = z.discriminatedUnion("kind", [
  EasyOcrOptionsSchema,
  RapidOcrOptionsSchema,
  TesseractCliOcrOptionsSchema,
  TesseractOcrOptionsSchema,
  OcrMacOptionsSchema,
]);

export const PdfBackendSchema = z.enum(
  ["pypdfium2", "dlparse_v1", "dlparse_v2", "dlparse_v4"],
  {
    error:
      "Invalid PDF backend. Supported backends: pypdfium2, dlparse_v1, dlparse_v2, dlparse_v4",
  }
);

export const TableModeSchema = z.enum(["fast", "accurate"], {
  error: "Invalid table mode. Supported modes: fast, accurate",
});

export const TableStructureOptionsSchema = z
  .object({
    do_cell_matching: z.boolean().optional(),
    mode: TableModeSchema.optional(),
  })
  .optional();

export const ImageExportModeSchema = z.enum(
  ["embedded", "placeholder", "referenced"],
  {
    error:
      "Invalid image export mode. Supported modes: embedded, placeholder, referenced",
  }
);

export const ProcessingPipelineSchema = z.enum(
  ["default", "fast", "accurate"],
  {
    error:
      "Invalid processing pipeline. Supported pipelines: default, fast, accurate",
  }
);

/**
 * Task status schema with custom error handling
 */
export const TaskStatusSchema = z.enum(
  ["pending", "started", "success", "failure", "cancelled"],
  {
    error:
      "Invalid task status. Supported statuses: pending, started, success, failure, cancelled",
  }
);

/**
 * Conversion options schema with enhanced validation
 */
export const ConversionOptionsSchema = z
  .object({
    to_formats: z
      .array(OutputFormatSchema, {
        error: "to_formats must be an array of valid output formats",
      })
      .min(1, { error: "At least one output format is required" })
      .optional(),

    ocr_engine: OcrEngineSchema.optional(),
    pdf_backend: PdfBackendSchema.optional(),
    table_mode: TableModeSchema.optional(),
    image_export_mode: ImageExportModeSchema.optional(),
    processing_pipeline: ProcessingPipelineSchema.optional(),

    force_ocr: z
      .boolean({
        error: "force_ocr must be a boolean value",
      })
      .optional(),

    page_range: z
      .tuple(
        [
          z.number().int().min(1, { error: "Start page must be at least 1" }),
          z.number().int().min(1, { error: "End page must be at least 1" }),
        ],
        {
          error: "page_range must be a tuple of [start_page, end_page]",
        }
      )
      .refine(([start, end]) => start <= end, {
        error: "Start page must be less than or equal to end page",
      })
      .optional(),

    extract_images: z
      .boolean({
        error: "extract_images must be a boolean value",
      })
      .optional(),

    extract_tables: z
      .boolean({
        error: "extract_tables must be a boolean value",
      })
      .optional(),

    extract_text: z
      .boolean({
        error: "extract_text must be a boolean value",
      })
      .optional(),

    table_cell_matching: z
      .boolean({
        error: "table_cell_matching must be a boolean value",
      })
      .optional(),

    document_timeout: z
      .number({
        error: "document_timeout must be a number",
      })
      .positive()
      .optional(),

    do_ocr: z
      .boolean({
        error: "do_ocr must be a boolean value",
      })
      .optional(),

    do_table_structure: z
      .boolean({
        error: "do_table_structure must be a boolean value",
      })
      .optional(),

    do_code_enrichment: z
      .boolean({
        error: "do_code_enrichment must be a boolean value",
      })
      .optional(),

    do_formula_enrichment: z
      .boolean({
        error: "do_formula_enrichment must be a boolean value",
      })
      .optional(),

    do_picture_classification: z
      .boolean({
        error: "do_picture_classification must be a boolean value",
      })
      .optional(),

    do_picture_description: z
      .boolean({
        error: "do_picture_description must be a boolean value",
      })
      .optional(),

    picture_description_area_threshold: z
      .number({
        error: "picture_description_area_threshold must be a number",
      })
      .min(0)
      .max(1)
      .optional(),

    include_images: z
      .boolean({
        error: "include_images must be a boolean value",
      })
      .optional(),

    images_scale: z
      .number({
        error: "images_scale must be a number",
      })
      .positive()
      .optional(),

    md_page_break_placeholder: z
      .string({
        error: "md_page_break_placeholder must be a string",
      })
      .optional(),

    abort_on_error: z
      .boolean({
        error: "abort_on_error must be a boolean value",
      })
      .optional(),

    vlm_pipeline_model: z
      .enum(["smoldocling"], {
        error: "Invalid VLM pipeline model. Supported models: smoldocling",
      })
      .optional(),

    vlm_pipeline_model_local: z
      .object({
        repo_id: z.string(),
        prompt: z.string(),
        scale: z.number(),
        response_format: z.enum(["doctags", "markdown"]),
        inference_framework: z.enum(["transformers", "mlx"]),
        transformers_model_type: z.enum(["automodel-vision2seq", "automodel"]),
        extra_generation_config: z.record(z.string(), z.unknown()),
      })
      .optional(),

    vlm_pipeline_model_api: z
      .object({
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        timeout: z.number(),
        concurrency: z.number(),
        prompt: z.string(),
        scale: z.number(),
        response_format: z.enum(["doctags", "markdown"]),
      })
      .optional(),

    picture_description_local: z
      .object({
        repo_id: z.string(),
        prompt: z.string(),
        scale: z.number(),
        response_format: z.enum(["doctags", "markdown"]),
        inference_framework: z.enum(["transformers", "mlx"]),
        transformers_model_type: z.enum(["automodel-vision2seq", "automodel"]),
        extra_generation_config: z.record(z.string(), z.unknown()),
      })
      .optional(),

    picture_description_api: z
      .object({
        url: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
        params: z.record(z.string(), z.unknown()).optional(),
        timeout: z.number().optional(),
        concurrency: z.number().optional(),
        prompt: z.string().optional(),
      })
      .optional(),

    ocr_options: OcrOptionsSchema.optional(),

    table_structure_options: TableStructureOptionsSchema.optional(),
    layout_options: LayoutOptionsSchema.optional(),
    accelerator_options: AcceleratorOptionsSchema.optional(),

    generate_page_images: z.boolean().optional(),
    generate_picture_images: z.boolean().optional(),

    create_legacy_output: z.boolean().optional(),
    force_backend_text: z.boolean().optional(),
    enable_remote_services: z.boolean().optional(),
    allow_external_plugins: z.boolean().optional(),
    artifacts_path: z.string().optional(),
  })
  .strict();

/**
 * CLI convert options schema
 */
export const CliConvertOptionsSchema = ConversionOptionsSchema.extend({
  sources: z
    .array(z.string())
    .min(1, { error: "At least one source is required" }),
  input: z.string().optional(),
  output: z.string().optional(),
  from_formats: z.array(InputFormatSchema).optional(),
  verbose: z.boolean().optional(),
  quiet: z.boolean().optional(),
  debug: z.boolean().optional(),
  config: z.string().optional(),
  timeout: z.number().positive().optional(),
  max_retries: z.number().nonnegative().optional(),
}).strict();

/**
 * File metadata schema
 */
export const FileMetadataSchema = z
  .object({
    filename: z.string(),
    size: z.number().nonnegative().optional(),
    contentType: z.string(),
    lastModified: z.date().optional(),
  })
  .strict();

/**
 * Progress update schema
 */
export const ProgressUpdateSchema = z
  .object({
    stage: z.string(),
    percentage: z.number().min(0).max(100).optional(),
    message: z.string().optional(),
    taskId: z.string().optional(),
    position: z.number().nonnegative().optional(),
    status: z.string().optional(),
    timestamp: z.number(),
    source: z.enum(["http", "websocket"]).optional(),
    memoryUsage: z
      .object({
        rss: z.number(),
        heapTotal: z.number(),
        heapUsed: z.number(),
        external: z.number(),
        arrayBuffers: z.number(),
      })
      .optional(),
    uploadedBytes: z.number().nonnegative().optional(),
    totalBytes: z.number().nonnegative().optional(),
    bytesPerSecond: z.number().nonnegative().optional(),
  })
  .strict();

/**
 * Task status response schema
 */
export const TaskStatusResponseSchema = z
  .object({
    task_id: z.string(),
    task_status: TaskStatusSchema,
    task_position: z.number().nonnegative().optional(),
    task_meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Document content schema
 */
export const DocumentContentSchema = z
  .object({
    md_content: z.string().optional(),
    json_content: z.unknown().optional(),
    html_content: z.string().optional(),
    text_content: z.string().optional(),
    doctags_content: z.unknown().optional(),
  })
  .strict();

/**
 * Conversion result schema
 */
export const ConversionResultSchema = z
  .object({
    success: z.boolean(),
    document: DocumentContentSchema.optional(),
    processing_time: z.number().nonnegative().optional(),
    timings: z.record(z.string(), z.number()).optional(),
    error: z
      .object({
        message: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional(),
      })
      .optional(),
  })
  .strict();

/**
 * File conversion result schema
 */
export const ConversionFileResultSchema = z
  .object({
    success: z.boolean(),
    fileMetadata: FileMetadataSchema,
    fileStream: z.unknown().optional(),
    error: z
      .object({
        message: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional(),
      })
      .optional(),
  })
  .strict();

/**
 * API client configuration schema
 */
export const ApiClientConfigSchema = z
  .object({
    baseUrl: z.string().regex(/^https?:\/\/.+/, "Invalid URL format"),
    timeout: z.number().positive().default(30000),
    retries: z.number().nonnegative().default(3),
    retryDelay: z.number().nonnegative().default(1000),
    headers: z.record(z.string(), z.string()).optional(),
    apiKey: z.string().optional(),
  })
  .strict();

/**
 * CLI client configuration schema
 */
export const CliClientConfigSchema = z
  .object({
    pythonPath: z.string().default("python"),
    doclingPath: z.string().optional(),
    timeout: z.number().positive().default(300000),
    maxRetries: z.number().nonnegative().default(3),
    retryDelay: z.number().nonnegative().default(1000),
    tempDir: z.string().optional(),
    cleanupTemp: z.boolean().default(true),
    verbose: z.boolean().default(false),
  })
  .strict();

/**
 * WebSocket configuration schema
 */
export const WebSocketConfigSchema = z
  .object({
    url: z.string().regex(/^wss?:\/\/.+/, "Invalid WebSocket URL format"),
    reconnectAttempts: z.number().nonnegative().default(5),
    reconnectDelay: z.number().nonnegative().default(1000),
    timeout: z.number().positive().default(30000),
    heartbeatInterval: z.number().positive().default(30000),
  })
  .strict();

/**
 * Progress configuration schema
 */
export const ProgressConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    interval: z.number().positive().default(1000),
    useWebSocket: z.boolean().default(false),
    onProgress: z.any().optional(),
    onComplete: z.any().optional(),
    onError: z.any().optional(),
  })
  .strict();

/**
 * Connection pool configuration schema
 */
export const ConnectionPoolConfigSchema = z
  .object({
    maxSockets: z.number().positive().default(50),
    maxFreeSockets: z.number().nonnegative().default(10),
    timeout: z.number().positive().default(60000),
    keepAliveTimeout: z.number().positive().default(30000),
    keepAlive: z.boolean().default(true),
    maxRequestsPerSocket: z.number().positive().optional(),
    socketTimeout: z.number().positive().optional(),
  })
  .strict();

/**
 * Type inference from schemas
 */
export type InputFormat = z.infer<typeof InputFormatSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type OcrEngine = z.infer<typeof OcrEngineSchema>;
export type PdfBackend = z.infer<typeof PdfBackendSchema>;
export type TableMode = z.infer<typeof TableModeSchema>;
export type ImageExportMode = z.infer<typeof ImageExportModeSchema>;
export type ProcessingPipeline = z.infer<typeof ProcessingPipelineSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ConversionOptions = z.infer<typeof ConversionOptionsSchema>;
export type CliConvertOptions = z.infer<typeof CliConvertOptionsSchema>;
export type FileMetadata = z.infer<typeof FileMetadataSchema>;
export type ProgressUpdate = z.infer<typeof ProgressUpdateSchema>;
export type TaskStatusResponse = z.infer<typeof TaskStatusResponseSchema>;
export type DocumentContent = z.infer<typeof DocumentContentSchema>;
export type ConversionResult = z.infer<typeof ConversionResultSchema>;
export type ConversionFileResult = z.infer<typeof ConversionFileResultSchema>;
export type ApiClientConfig = z.infer<typeof ApiClientConfigSchema>;
export type CliClientConfig = z.infer<typeof CliClientConfigSchema>;
export type WebSocketConfig = z.infer<typeof WebSocketConfigSchema>;
export type ProgressConfig = z.infer<typeof ProgressConfigSchema>;
export type ConnectionPoolConfig = z.infer<typeof ConnectionPoolConfigSchema>;

/**
 * Validation utilities using Zod schemas
 */

export class ZodValidation {
  /**
   * Validate conversion options
   */
  static validateConversionOptions(options: unknown): ConversionOptions {
    return ConversionOptionsSchema.parse(options);
  }

  /**
   * Safe validation that returns a result instead of throwing
   */
  static safeValidateConversionOptions(options: unknown) {
    return ConversionOptionsSchema.safeParse(options);
  }

  /**
   * Validate CLI convert options
   */
  static validateCliConvertOptions(options: unknown): CliConvertOptions {
    return CliConvertOptionsSchema.parse(options);
  }

  /**
   * Validate API client configuration
   */
  static validateApiClientConfig(config: unknown): ApiClientConfig {
    return ApiClientConfigSchema.parse(config);
  }

  /**
   * Validate CLI client configuration
   */
  static validateCliClientConfig(config: unknown): CliClientConfig {
    return CliClientConfigSchema.parse(config);
  }

  /**
   * Validate progress update
   */
  static validateProgressUpdate(update: unknown): ProgressUpdate {
    return ProgressUpdateSchema.parse(update);
  }

  /**
   * Validate task status response
   */
  static validateTaskStatusResponse(response: unknown): TaskStatusResponse {
    return TaskStatusResponseSchema.parse(response);
  }

  /**
   * Validate conversion result
   */
  static validateConversionResult(result: unknown): ConversionResult {
    return ConversionResultSchema.parse(result);
  }

  /**
   * Type guards using Zod schemas
   */
  static isValidInputFormat(value: unknown): value is InputFormat {
    return InputFormatSchema.safeParse(value).success;
  }

  static isValidOutputFormat(value: unknown): value is OutputFormat {
    return OutputFormatSchema.safeParse(value).success;
  }

  static isValidOcrEngine(value: unknown): value is OcrEngine {
    return OcrEngineSchema.safeParse(value).success;
  }

  static isValidPdfBackend(value: unknown): value is PdfBackend {
    return PdfBackendSchema.safeParse(value).success;
  }

  static isValidTableMode(value: unknown): value is TableMode {
    return TableModeSchema.safeParse(value).success;
  }

  static isValidImageExportMode(value: unknown): value is ImageExportMode {
    return ImageExportModeSchema.safeParse(value).success;
  }

  static isValidProcessingPipeline(
    value: unknown
  ): value is ProcessingPipeline {
    return ProcessingPipelineSchema.safeParse(value).success;
  }

  static isValidTaskStatus(value: unknown): value is TaskStatus {
    return TaskStatusSchema.safeParse(value).success;
  }
}
