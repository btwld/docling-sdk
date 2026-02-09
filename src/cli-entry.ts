/**
 * CLI-only entry point for docling-sdk
 * This module is only available in Node.js and contains the CLI client
 *
 * Import from "docling-sdk/cli" to access CLI functionality
 */

// CLI client and utilities
export { DoclingCLIClient } from "./clients/cli-client";
export { CliUtils } from "./cli/utils";

// CLI types
export type {
  CliConvertOptions,
  CliModelDownloadOptions,
  CliResult,
  CliConversionResult,
  CliModelDownloadResult,
  CliConfig,
  CliVersionInfo,
  CliCommand,
  CliModelsCommand,
  CliExecutionOptions,
  CliProgressCallback,
  CliAsyncOptions,
  CliVlmModelType,
  AsrModelType,
  AvailableModel,
} from "./types/cli";

export { CliError, CliTimeoutError, CliNotFoundError, CliValidation } from "./types/cli";

// Re-export common types needed for CLI
export type {
  DoclingCLIConfig,
  DoclingConfig,
  DoclingClientBase,
} from "./types/client";

export type {
  InputFormat,
  OutputFormat,
  OcrEngine,
  PdfBackend,
} from "./types/api";

// Re-export the factory for CLI
export { createCLIClient, isCLIClient } from "./docling";
