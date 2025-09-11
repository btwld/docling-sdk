import type { DoclingDocument } from "./docling-core";
import type { NodeReadable } from "./streams";

/**
 * Input formats supported by Docling
 */
export type InputFormat =
  | "docx"
  | "pptx"
  | "html"
  | "image"
  | "pdf"
  | "asciidoc"
  | "md"
  | "csv"
  | "xlsx"
  | "xml_uspto"
  | "xml_jats"
  | "json_docling"
  | "audio";

/**
 * Output formats supported by Docling
 */
export type OutputFormat =
  | "md"
  | "json"
  | "html"
  | "html_split_page"
  | "text"
  | "doctags";

/**
 * OCR engines available
 */
export type OcrEngine =
  | "easyocr"
  | "tesserocr"
  | "tesseract"
  | "rapidocr"
  | "ocrmac";

/**
 * PDF backends available
 */
export type PdfBackend =
  | "pypdfium2"
  | "dlparse_v1"
  | "dlparse_v2"
  | "dlparse_v4";

/**
 * Table extraction modes
 */
export type TableMode = "fast" | "accurate";

/**
 * Table structure options
 */
export interface TableStructureOptions {
  do_cell_matching?: boolean;
  mode?: TableMode;
}

/**
 * Layout model configurations
 */
export interface LayoutOptions {
  create_orphan_clusters?: boolean;
  keep_empty_clusters?: boolean;
  model_spec?: string;
}

/**
 * Accelerator device options
 */
export type AcceleratorDevice = "auto" | "cpu" | "cuda" | "mps";

/**
 * Accelerator options
 */
export interface AcceleratorOptions {
  device?: AcceleratorDevice;
  num_threads?: number;
}

/**
 * Image export modes
 */
export type ImageExportMode = "embedded" | "placeholder" | "referenced";

/**
 * Processing pipelines
 */
export type ProcessingPipeline = "standard" | "vlm" | "asr";

/**
 * Base OCR options interface
 */
export interface BaseOcrOptions {
  kind: OcrEngine;
  lang: string[];
  force_full_page_ocr?: boolean;
  bitmap_area_threshold?: number;
}

/**
 * EasyOCR specific options
 */
export interface EasyOcrOptions extends BaseOcrOptions {
  kind: "easyocr";
  lang: string[];
  use_gpu?: boolean;
  confidence_threshold?: number;
  model_storage_directory?: string;
  recog_network?: string;
  download_enabled?: boolean;
}

/**
 * RapidOCR specific options
 */
export interface RapidOcrOptions extends BaseOcrOptions {
  kind: "rapidocr";
  lang: string[];
  text_score?: number;
  use_det?: boolean;
  use_cls?: boolean;
  use_rec?: boolean;
  print_verbose?: boolean;
  det_model_path?: string;
  cls_model_path?: string;
  rec_model_path?: string;
  rec_keys_path?: string;
}

/**
 * Tesseract CLI specific options
 */
export interface TesseractCliOcrOptions extends BaseOcrOptions {
  kind: "tesseract";
  lang: string[];
  tesseract_cmd?: string;
  path?: string;
}

/**
 * Tesseract OCR specific options
 */
export interface TesseractOcrOptions extends BaseOcrOptions {
  kind: "tesserocr";
  lang: string[];
  path?: string;
}

/**
 * Mac OCR specific options
 */
export interface OcrMacOptions extends BaseOcrOptions {
  kind: "ocrmac";
  lang: string[];
  recognition?: string;
  framework?: string;
}

/**
 * Union type for all OCR options
 */
export type OcrOptions =
  | EasyOcrOptions
  | RapidOcrOptions
  | TesseractCliOcrOptions
  | TesseractOcrOptions
  | OcrMacOptions;

/**
 * Task status for async operations
 */
export type TaskStatus = "pending" | "started" | "success" | "failure";

/**
 * Conversion status
 */
export type ConversionStatus =
  | "success"
  | "partial_success"
  | "skipped"
  | "failure";

/**
 * HTTP source for URL-based conversion
 */
export interface HttpSource {
  kind: "http";
  url: string;
  headers?: Record<string, string>;
}

/**
 * File source for base64-encoded files
 */
export interface FileSource {
  kind: "file";
  base64_string: string;
  filename: string;
}

/**
 * S3 source for files stored in S3 buckets
 * Fields match the OpenAPI specification
 */
export interface S3Source {
  kind: "s3";
  endpoint: string;
  verify_ssl?: boolean;
  access_key: string;
  secret_key: string;
  bucket: string;
  key_prefix?: string;
}

/**
 * Picture description configuration for local VLM
 */
export interface PictureDescriptionLocal {
  repo_id: string;
  generation_config?: {
    max_new_tokens?: number;
    do_sample?: boolean;
    [key: string]: unknown;
  };
  prompt?: string;
}

/**
 * Picture description configuration for API-based VLM
 */
export interface PictureDescriptionApi {
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  timeout?: number;
  concurrency?: number;
  prompt?: string;
}

/**
 * VLM model types for preset configurations
 */
export type VlmModelType = "smoldocling";

/**
 * VLM model configuration for local models
 */
export interface VlmModelLocal {
  repo_id: string;
  prompt: string;
  scale: number;
  response_format: "doctags" | "markdown";
  inference_framework: "transformers" | "mlx";
  transformers_model_type: "automodel-vision2seq" | "automodel";
  extra_generation_config: Record<string, unknown>;
}

/**
 * VLM model configuration for API-based models
 */
export interface VlmModelApi {
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  timeout: number;
  concurrency: number;
  prompt: string;
  scale: number;
  response_format: "doctags" | "markdown";
}

/**
 * Conversion options for API requests
 */
export interface ConversionOptions {
  from_formats?: InputFormat[];
  to_formats?: OutputFormat[];

  pipeline?: ProcessingPipeline;
  page_range?: [number, number];

  do_ocr?: boolean;
  force_ocr?: boolean;
  ocr_engine?: OcrEngine;
  ocr_lang?: string[];
  ocr_options?: OcrOptions;

  pdf_backend?: PdfBackend;

  table_mode?: TableMode;
  table_cell_matching?: boolean;
  do_table_structure?: boolean;
  table_structure_options?: TableStructureOptions;

  image_export_mode?: ImageExportMode;
  include_images?: boolean;
  images_scale?: number;
  generate_page_images?: boolean;
  generate_picture_images?: boolean;

  do_code_enrichment?: boolean;
  do_formula_enrichment?: boolean;
  do_picture_classification?: boolean;
  do_picture_description?: boolean;
  picture_description_area_threshold?: number;
  picture_description_local?: PictureDescriptionLocal;
  picture_description_api?: PictureDescriptionApi;

  abort_on_error?: boolean;
  document_timeout?: number;
  md_page_break_placeholder?: string;
  create_legacy_output?: boolean;
  force_backend_text?: boolean;

  layout_options?: LayoutOptions;

  accelerator_options?: AcceleratorOptions;

  enable_remote_services?: boolean;
  allow_external_plugins?: boolean;
  artifacts_path?: string;

  vlm_pipeline_model?: VlmModelType;
  vlm_pipeline_model_local?: VlmModelLocal;
  vlm_pipeline_model_api?: VlmModelApi;
}

/**
 * Target types for conversion results
 */
export interface InBodyTarget {
  kind: "inbody";
}

export interface ZipTarget {
  kind: "zip";
}

export interface S3Target {
  kind: "s3";
  endpoint: string;
  verify_ssl?: boolean;
  access_key: string;
  secret_key: string;
  bucket: string;
  key_prefix?: string;
}

export interface PutTarget {
  kind: "put";
  presigned_url: string;
}

export type ConversionTarget = InBodyTarget | ZipTarget | S3Target | PutTarget;

/**
 * Request for source-based conversion
 */
export interface ConvertDocumentsRequest {
  options?: ConversionOptions;
  sources: (HttpSource | FileSource | S3Source)[];
  target?: ConversionTarget;
}

/**
 * Document export response (matches OpenAPI ExportDocumentResponse)
 */
export interface ExportDocumentResponse {
  filename: string; // Required in OpenAPI
  md_content?: string | null;
  json_content?: DoclingDocument | null;
  html_content?: string | null;
  text_content?: string | null;
  doctags_content?: string | null;
}

/**
 * @deprecated Use ExportDocumentResponse instead
 */
export interface DocumentContent extends ExportDocumentResponse {
  content?: string | object | undefined;
}

/**
 * Timing information for processing steps
 */
export interface ProcessingTimings {
  [step: string]: number;
}

/**
 * Error information
 */
export interface ProcessingError {
  message: string;
  code?: string | undefined;
  details?: unknown;
}

/**
 * Single document conversion response (matches OpenAPI ConvertDocumentResponse)
 */
export interface ConvertDocumentResponse {
  document: ExportDocumentResponse;
  status: ConversionStatus;
  processing_time: number;
  timings?: ProcessingTimings;
  errors?: ProcessingError[];
}

/**
 * Response for PUT target conversions (presigned URL uploads)
 * Matches OpenAPI PresignedUrlConvertDocumentResponse
 */
export interface PresignedUrlConvertDocumentResponse {
  processing_time: number;
  num_converted: number;
  num_succeeded: number;
  num_failed: number;
}

/**
 * Task metadata for async operations
 */
export interface TaskMeta {
  total_documents?: number;
  processed_documents?: number;
  [key: string]: unknown;
}

/**
 * Task status response for async operations
 */
export interface TaskStatusResponse {
  task_id: string;
  task_status: TaskStatus;
  task_position?: number;
  task_meta?: TaskMeta;
}

/**
 * WebSocket message types
 */
export type WebSocketMessageType = "connection" | "update" | "error";

/**
 * WebSocket message structure
 */
export interface WebSocketMessage {
  message: WebSocketMessageType;
  task?: TaskStatusResponse;
  error?: string;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: "ok";
  timestamp?: string;
}

/**
 * Progress callback response
 */
export interface ProgressCallbackResponse {
  success: boolean;
  message?: string;
}

/**
 * File upload parameters for multipart form data
 */
export interface FileUploadParams extends ConversionOptions {
  files: File | File[] | Buffer | Buffer[];
  filename?: string | string[];
}

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

/**
 * Standard conversion success result with document content
 */
export interface DocumentConversionSuccess {
  success: true;
  data: ConvertDocumentResponse;
  taskId?: string;
}

/**
 * Target conversion success result (S3, PUT, etc.) - no document content returned
 */
export interface TargetConversionSuccess {
  success: true;
  data: PresignedUrlConvertDocumentResponse;
  taskId?: string;
}

/**
 * Failed conversion result with error
 */
export interface ConversionFailure {
  success: false;
  error: ProcessingError;
  taskId?: string;
}

/**
 * Standard conversion result for most operations (convert, extractText, etc.)
 * TypeScript will know that result.data.document exists when success=true
 */
export type ConversionResult = DocumentConversionSuccess | ConversionFailure;

/**
 * Target conversion result for operations with custom targets (S3, PUT, etc.)
 * TypeScript will know the appropriate response type based on the operation
 */
export type TargetConversionResult =
  | TargetConversionSuccess
  | ConversionFailure;

/**
 * Union of all possible conversion results (for internal API methods)
 */
export type AnyConversionResult = ConversionResult | TargetConversionResult;

/**
 * Type guard to check if standard conversion result is successful
 * When true, TypeScript knows result.data.document exists
 */
export function isConversionSuccess(
  result: ConversionResult
): result is DocumentConversionSuccess {
  return result.success === true;
}

/**
 * Type guard to check if target conversion result is successful
 * When true, TypeScript knows result.data has PresignedUrlConvertDocumentResponse structure
 */
export function isTargetConversionSuccess(
  result: TargetConversionResult
): result is TargetConversionSuccess {
  return result.success === true;
}

/**
 * Type guard to check if any conversion result is a failure
 */
export function isConversionFailure(
  result: AnyConversionResult
): result is ConversionFailure {
  return result.success === false;
}

/**
 * Type guard to check if response data has document content
 */
export function hasDocumentContent(
  data: ConvertDocumentResponse | PresignedUrlConvertDocumentResponse
): data is ConvertDocumentResponse {
  return "document" in data;
}

/**
 * Type guard to check if response data is presigned URL response
 */
export function isPresignedUrlResponse(
  data: ConvertDocumentResponse | PresignedUrlConvertDocumentResponse
): data is PresignedUrlConvertDocumentResponse {
  return !("document" in data);
}

/**
 * Helper function to create a successful conversion result
 * Ensures proper literal type for success property
 */
export function createSuccessResult(
  data: ConvertDocumentResponse,
  taskId?: string
): DocumentConversionSuccess {
  return {
    success: true as const,
    data,
    ...(taskId && { taskId }),
  };
}

/**
 * Helper function to create a failed conversion result
 * Ensures proper literal type for success property
 */
export function createFailureResult(
  error: ProcessingError,
  taskId?: string
): ConversionFailure {
  return {
    success: false as const,
    error,
    ...(taskId && { taskId }),
  };
}

/**
 * Result for file-based conversions (ZIP downloads)
 */
export interface ConversionFileResult {
  success: boolean;
  fileStream?: NodeReadable;
  fileMetadata?: {
    filename: string;
    contentType: string;
    size?: number;
  };
  error?: ProcessingError | undefined;
}

/**
 * Async conversion task interface
 */
export interface AsyncConversionTask {
  taskId: string;
  status: TaskStatus;
  position?: number | undefined;
  meta?: TaskMeta | undefined;

  on(event: "progress", listener: (status: TaskStatusResponse) => void): this;
  on(
    event: "complete",
    listener: (result: ConvertDocumentResponse) => void
  ): this;
  on(event: "error", listener: (error: ProcessingError) => void): this;

  poll(): Promise<TaskStatusResponse>;
  waitForCompletion(): Promise<TaskStatusResponse>;
  getResult(): Promise<ConvertDocumentResponse>;
  cancel?(): Promise<void>;
}
