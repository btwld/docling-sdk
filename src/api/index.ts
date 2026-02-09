export { HttpClient } from "./http";
export { DoclingAPIClient } from "../clients/api-client";

// Note: ConnectionPool is deprecated in favor of cross-runtime HTTP client
// The ofetch library handles connection pooling internally

export type {
  ApiClientConfig,
  ConvertDocumentsRequest,
  ConvertDocumentResponse,
  PresignedUrlConvertDocumentResponse,
  TaskStatusResponse,
  HealthCheckResponse,
  FileUploadParams,
  ConversionOptions,
  HttpSource,
  FileSource,
  S3Source,
  InBodyTarget,
  ZipTarget,
  S3Target,
  PutTarget,
  ConversionTarget,
  AsyncConversionTask,
  ConversionResult,
  ProcessingError,
  DocumentContent,
  TaskMeta,
  WebSocketMessage,
  WebSocketMessageType,
  InputFormat,
  OutputFormat,
  OcrEngine,
  PdfBackend,
  TableMode,
  ImageExportMode,
  ProcessingPipeline,
  TaskStatus,
  ConversionStatus,
  PictureDescriptionLocal,
  PictureDescriptionApi,
  VlmModelType,
  VlmModelLocal,
  VlmModelApi,
  ProcessingTimings,
  ProgressCallbackResponse,
} from "../types/api";

export {
  DoclingNetworkError,
  DoclingTimeoutError,
  DoclingValidationError,
  DoclingFileError,
} from "../types";
