// ============================================================================
// Web OCR Types (namespaced with WebOCR* to avoid conflicts with docling-core.ts)
// ============================================================================

/**
 * Reference to another item in the document
 */
export interface WebOCRRefItem {
  $ref: string;
}

/**
 * Bounding box for element positioning
 */
export interface WebOCRBoundingBox {
  l: number;
  t: number;
  r: number;
  b: number;
  coord_origin: "TOPLEFT" | "BOTTOMLEFT";
}

/**
 * Provenance information for an item
 */
export interface WebOCRProvenanceItem {
  page_no: number;
  bbox: WebOCRBoundingBox;
  charspan: [number, number];
}

/**
 * Content item reference
 */
export type WebOCRContentItem = WebOCRRefItem;

/**
 * Base item interface
 */
export interface WebOCRBaseItem {
  self_ref: string;
  parent: WebOCRRefItem | null;
  children: WebOCRContentItem[];
  label: string;
  prov?: WebOCRProvenanceItem[];
}

/**
 * Text item in the document
 */
export interface WebOCRTextItem extends WebOCRBaseItem {
  label:
    | "title"
    | "section_header"
    | "text"
    | "code"
    | "formula"
    | "list_item"
    | "caption"
    | "footnote"
    | "page_header"
    | "page_footer";
  orig: string;
  text: string;
  level?: number;
  enumerated?: boolean;
  language?: string;
}

/**
 * Table cell data
 */
export interface WebOCRTableCell {
  text: string;
  row_span: number;
  col_span: number;
  start_row_offset_idx: number;
  end_row_offset_idx: number;
  start_col_offset_idx: number;
  end_col_offset_idx: number;
  col_header: boolean;
  row_header: boolean;
}

/**
 * Table data structure
 */
export interface WebOCRTableData {
  num_rows: number;
  num_cols: number;
  table_cells: WebOCRTableCell[];
}

/**
 * Table item in the document
 */
export interface WebOCRTableItem extends WebOCRBaseItem {
  label: "table";
  data: WebOCRTableData;
}

/**
 * Picture/image item in the document
 */
export interface WebOCRPictureItem extends WebOCRBaseItem {
  label: "picture" | "chart";
  caption?: string;
  image?: string;
}

/**
 * Group item (container for other items)
 */
export interface WebOCRGroupItem extends WebOCRBaseItem {
  label: "body" | "group";
}

/**
 * Page information
 */
export interface WebOCRPageItem {
  size: {
    width: number;
    height: number;
  };
}

/**
 * Main document structure
 */
export interface WebOCRDocument {
  schema_name: "DoclingDocument";
  version: string;
  name: string;
  texts: WebOCRTextItem[];
  tables: WebOCRTableItem[];
  pictures: WebOCRPictureItem[];
  body: WebOCRGroupItem;
  pages: Record<number, WebOCRPageItem>;
}

// ============================================================================
// Table Extraction Types
// ============================================================================

/**
 * Extracted table structure for easy data access
 */
export interface ExtractedTable {
  headers: string[];
  rows: string[][];
}

/**
 * Element overlay for visualization (bounding box extracted from DocTags)
 */
export interface ElementOverlay {
  tagType: string;
  bbox: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

// ============================================================================
// Client Configuration and Result Types
// ============================================================================

/**
 * Configuration for the web client (nested in DoclingConfig)
 */
export interface DoclingWebConfig {
  device?: "webgpu" | "wasm" | "auto";
  modelId?: string;
  maxNewTokens?: number;
  wasmPaths?: Record<string, string>;
  workerUrl?: string;
}

/**
 * Internal flattened config for DoclingWebClient
 */
export interface DoclingWebClientConfig extends DoclingWebConfig {
  type: "web";
}

/**
 * Result of processing an image with the web client
 */
export interface WebOCRResult {
  raw: string;
  html: string;
  markdown: string;
  plainText: string;
  json: WebOCRDocument;
  tables: ExtractedTable[];
  overlays: ElementOverlay[];
}

/**
 * Image input types supported by the web client
 */
export type ImageInput =
  | File
  | Blob
  | string
  | HTMLCanvasElement
  | HTMLImageElement
  | ImageBitmap
  | OffscreenCanvas;

/**
 * Options for processing an image
 */
export interface WebProcessOptions {
  maxNewTokens?: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Progress event data during model loading
 */
export interface LoadingProgress {
  progress: number;
  status: string;
}

/**
 * Stream event data during inference
 */
export interface StreamChunk {
  chunk: string;
  progress: number;
}

/**
 * Status report during processing
 */
export interface StatusReport {
  status: string;
}

/**
 * Error event data
 */
export interface WebClientError {
  message: string;
  code?: string;
}

/**
 * Event types for DoclingWebClient
 */
export type WebClientEvents = {
  loading: LoadingProgress;
  ready: undefined;
  status: StatusReport;
  stream: StreamChunk;
  complete: WebOCRResult;
  error: WebClientError;
};

// ============================================================================
// Worker Message Types (internal)
// ============================================================================

export type WorkerMessageToWorker =
  | { type: "INIT"; config: DoclingWebConfig }
  | { type: "PROCESS_FILE"; src: string; maxNewTokens?: number };

export type WorkerMessageFromWorker =
  | { type: "READY" }
  | { type: "PROGRESS"; progress: number; status: string }
  | { type: "REPORT"; status: string }
  | { type: "STREAM"; chunk: string; progress: number }
  | {
      type: "DONE";
      text: string;
      html: string;
      markdown: string;
      plainText: string;
      json: WebOCRDocument;
      tables: ExtractedTable[];
      overlays: ElementOverlay[];
    }
  | { type: "ERROR"; error: string };

// ============================================================================
// PDF Renderer Types
// ============================================================================

/**
 * A rendered page from a PDF document
 */
export interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}
