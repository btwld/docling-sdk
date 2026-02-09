export * from "./docling-core";
export * from "./api";
export * from "./cli";

// Generated types from OpenAPI spec (exported as namespace to avoid conflicts)
export type { OpenAPI, paths, components, operations } from "./generated";

// Type adapters for transforming between SDK and OpenAPI formats
export * from "./adapters";
export interface DoclingClientConfig {
  cli?: {
    doclingPath?: string;
    pythonPath?: string;
    timeout?: number;
    cwd?: string;
    env?: Record<string, string>;
  };
  api?: {
    baseUrl?: string;
    timeout?: number;
    headers?: Record<string, string>;
    retries?: number;
    retryDelay?: number;
  };
}

/**
 * Common error base class
 */
export class DoclingError extends Error {
  constructor(
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "DoclingError";
  }
}

/**
 * Network-related errors
 */
export class DoclingNetworkError extends DoclingError {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message, "NETWORK_ERROR");
    this.name = "DoclingNetworkError";
  }
}

/**
 * Validation errors
 */
export class DoclingValidationError extends DoclingError {
  constructor(
    message: string,
    public field?: string,
    public value?: unknown
  ) {
    super(message, "VALIDATION_ERROR");
    this.name = "DoclingValidationError";
  }
}

/**
 * Timeout errors
 */
export class DoclingTimeoutError extends DoclingError {
  constructor(timeout: number, operation?: string) {
    super(`Operation ${operation || "unknown"} timed out after ${timeout}ms`, "TIMEOUT_ERROR");
    this.name = "DoclingTimeoutError";
  }
}

/**
 * File processing errors
 */
export class DoclingFileError extends DoclingError {
  constructor(
    message: string,
    public filePath?: string,
    public fileSize?: number
  ) {
    super(message, "FILE_ERROR");
    this.name = "DoclingFileError";
  }
}

/**
 * Common utility functions
 */
export const DoclingUtils = {
  /**
   * Check if a file path exists and is readable
   */
  isValidFilePath: (path: string): boolean => {
    try {
      return typeof path === "string" && path.length > 0;
    } catch {
      // Ignore errors
      return false;
    }
  },

  /**
   * Get file extension from filename
   */
  getFileExtension: (filename: string): string => {
    const lastDot = filename.lastIndexOf(".");
    return lastDot === -1 ? "" : filename.slice(lastDot + 1).toLowerCase();
  },

  /**
   * Check if file extension is supported
   */
  isSupportedFileExtension: (filename: string): boolean => {
    const ext = DoclingUtils.getFileExtension(filename);
    const supportedExtensions = [
      "pdf",
      "docx",
      "pptx",
      "html",
      "htm",
      "md",
      "txt",
      "xlsx",
      "xls",
      "jpg",
      "jpeg",
      "png",
      "gif",
      "bmp",
      "tiff",
      "webp",
      "asciidoc",
      "adoc",
    ];
    return supportedExtensions.includes(ext);
  },

  /**
   * Format file size in human-readable format
   */
  formatFileSize: (bytes: number): string => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  },
};
