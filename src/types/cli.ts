import type {
  AcceleratorDevice,
  VlmModelType as ApiVlmModelType,
  ImageExportMode,
  InputFormat,
  OcrEngine,
  OutputFormat,
  PdfBackend,
  ProcessingPipeline,
  TableMode,
} from "./api";

/**
 * VLM (Vision Language Model) types for CLI
 * Extends API VLM types with CLI-specific models
 */
export type CliVlmModelType = ApiVlmModelType | "granite_vision" | "smolvlm";

/**
 * ASR (Automatic Speech Recognition) model types
 */
export type AsrModelType =
  | "whisper_tiny"
  | "whisper_small"
  | "whisper_medium"
  | "whisper_large"
  | "whisper_base"
  | "whisper_turbo";

/**
 * Available models for download
 */
export type AvailableModel =
  | "layout"
  | "tableformer"
  | "code_formula"
  | "picture_classifier"
  | "smolvlm"
  | "smoldocling"
  | "smoldocling_mlx"
  | "granite_vision"
  | "easyocr";

/**
 * CLI convert command options
 */
export interface CliConvertOptions {
  sources: string[];
  fromFormats?: InputFormat[];
  toFormats?: OutputFormat[];
  output?: string;

  pipeline?: ProcessingPipeline;
  vlmModel?: CliVlmModelType;
  asrModel?: AsrModelType;

  ocr?: boolean;
  forceOcr?: boolean;
  ocrEngine?: OcrEngine;
  ocrLang?: string[];

  pdfBackend?: PdfBackend;

  tableMode?: TableMode;

  imageExportMode?: ImageExportMode;
  showLayout?: boolean;

  enrichCode?: boolean;
  enrichFormula?: boolean;
  enrichPictureClasses?: boolean;
  enrichPictureDescriptions?: boolean;
  pictureDescriptionAreaThreshold?: number;

  abortOnError?: boolean;
  documentTimeout?: number;
  numThreads?: number;
  device?: AcceleratorDevice;

  artifactsPath?: string;
  allowExternalPlugins?: boolean;
  enableRemoteServices?: boolean;
  showExternalPlugins?: boolean;

  debugVisualizeCells?: boolean;
  debugVisualizeOcr?: boolean;
  debugVisualizeLayout?: boolean;
  debugVisualizeTables?: boolean;

  headers?: string;

  verbose?: number;
}

/**
 * CLI model download options
 */
export interface CliModelDownloadOptions {
  outputDir?: string;
  force?: boolean;
  models?: AvailableModel[];
  all?: boolean;
  quiet?: boolean;
}

/**
 * CLI execution result
 */
export interface CliResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: Error | undefined;
}

/**
 * CLI conversion result with parsed outputs
 */
export interface CliConversionResult extends CliResult {
  outputs?: {
    markdown?: string;
    json?: string;
    html?: string;
    text?: string;
    doctags?: string;
  };
  outputFiles?: string[];
}

/**
 * CLI model download result
 */
export interface CliModelDownloadResult extends CliResult {
  modelsPath?: string | undefined;
}

/**
 * CLI configuration
 */
export interface CliConfig {
  doclingPath?: string;
  doclingToolsPath?: string;
  pythonPath?: string;
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * CLI version information
 */
export interface CliVersionInfo {
  docling: string;
  doclingCore: string;
  doclingIbmModels: string;
  doclingParse: string;
  python: string;
  platform: string;
}

/**
 * CLI command types
 */
export type CliCommand = "convert" | "models" | "version" | "help";

/**
 * CLI models subcommand types
 */
export type CliModelsCommand = "download";

/**
 * CLI execution options
 */
export interface CliExecutionOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  stdio?: "pipe" | "inherit" | "ignore";
}

/**
 * CLI progress callback
 */
export type CliProgressCallback = (data: {
  type: "stdout" | "stderr";
  data: string;
}) => void;

/**
 * CLI async execution options
 */
export interface CliAsyncOptions extends CliExecutionOptions {
  onProgress?: CliProgressCallback;
}

/**
 * CLI error types
 */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stdout: string,
    public stderr: string
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class CliTimeoutError extends Error {
  constructor(timeout: number) {
    super(`CLI command timed out after ${timeout}ms`);
    this.name = "CliTimeoutError";
  }
}

export class CliNotFoundError extends Error {
  constructor(path?: string) {
    super(`Docling CLI not found${path ? ` at ${path}` : ""}`);
    this.name = "CliNotFoundError";
  }
}

/**
 * CLI validation helpers
 */
export const CliValidation = {
  isValidInputFormat: (format: string): format is InputFormat =>
    ["docx", "pptx", "html", "image", "pdf", "asciidoc", "md", "xlsx"].includes(
      format
    ),

  isValidOutputFormat: (format: string): format is OutputFormat =>
    ["md", "json", "html", "text", "doctags"].includes(format),

  isValidOcrEngine: (engine: string): engine is OcrEngine =>
    ["easyocr", "tesserocr", "tesseract", "rapidocr", "ocrmac"].includes(
      engine
    ),

  isValidPdfBackend: (backend: string): backend is PdfBackend =>
    ["pypdfium2", "dlparse_v1", "dlparse_v2", "dlparse_v4"].includes(backend),

  isValidTableMode: (mode: string): mode is TableMode =>
    ["fast", "accurate"].includes(mode),

  isValidImageExportMode: (mode: string): mode is ImageExportMode =>
    ["embedded", "placeholder", "referenced"].includes(mode),

  isValidProcessingPipeline: (
    pipeline: string
  ): pipeline is ProcessingPipeline => ["standard", "vlm"].includes(pipeline),

  isValidVlmModel: (model: string): model is CliVlmModelType =>
    ["smoldocling", "granite_vision", "smolvlm"].includes(model),

  isValidAsrModel: (model: string): model is AsrModelType =>
    [
      "whisper_tiny",
      "whisper_small",
      "whisper_medium",
      "whisper_large",
      "whisper_base",
      "whisper_turbo",
    ].includes(model),

  isValidAcceleratorDevice: (device: string): device is AcceleratorDevice =>
    ["auto", "cpu", "cuda", "mps"].includes(device),

  isValidAvailableModel: (model: string): model is AvailableModel =>
    [
      "layout",
      "tableformer",
      "code_formula",
      "picture_classifier",
      "smolvlm",
      "smoldocling",
      "smoldocling_mlx",
      "granite_vision",
      "easyocr",
    ].includes(model),
};
