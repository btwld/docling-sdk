/**
 * Web-specific entry point for docling-sdk
 * Provides browser-based OCR capabilities using the Granite Docling model.
 *
 * Import from "docling-sdk/web" for web-specific bundles.
 */

// Web client
import { DoclingWebClient } from "./clients/web-client";
import type { DoclingWebClientConfig } from "./types/web";

export { DoclingWebClient };

/**
 * Create a Web client (standalone, no factory dependency)
 */
export function createWebClient(
  options?: Partial<Omit<DoclingWebClientConfig, "type">>
): DoclingWebClient {
  return new DoclingWebClient({
    type: "web" as const,
    ...options,
  });
}

/**
 * Type guard to check if client is Web type
 */
export function isWebClient(client: unknown): client is DoclingWebClient {
  return client instanceof DoclingWebClient || (client as { type: string })?.type === "web";
}

// Converters (useful standalone)
export {
  DoclingConverter,
  doclingToHtml,
  doclingToMarkdown,
  doclingToPlainText,
  doclingToJson,
} from "./web/converters";

// Extractors (useful standalone)
export {
  extractTables,
  tableToCSV,
  tablesToCSV,
  extractOverlays,
} from "./web/extractors";

// Cache management
export {
  clearModelCache,
  getModelCacheSize,
} from "./web/cache";

// PDF renderer
export { renderPdfToImages } from "./web/pdf-renderer";

// Types
export type {
  DoclingWebClientConfig,
  DoclingWebConfig,
  WebOCRResult,
  WebOCRDocument,
  WebOCRTextItem,
  WebOCRTableItem,
  WebOCRPictureItem,
  WebOCRGroupItem,
  WebOCRPageItem,
  WebOCRBaseItem,
  WebOCRRefItem,
  WebOCRContentItem,
  WebOCRBoundingBox,
  WebOCRProvenanceItem,
  WebOCRTableCell,
  WebOCRTableData,
  ExtractedTable,
  ElementOverlay,
  ImageInput,
  WebProcessOptions,
  WebClientEvents,
  LoadingProgress,
  StreamChunk,
  StatusReport,
  WebClientError,
  WorkerMessageToWorker,
  WorkerMessageFromWorker,
  RenderedPage,
} from "./types/web";

export type { DoclingWeb } from "./types/client";
