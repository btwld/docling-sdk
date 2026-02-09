export * from "./types/docling-core";
export * from "./types/api";
export * from "./types/cli";
export * from "./types";

export * from "./utils/validation";
export * from "./utils/result";

export { CliUtils } from "./cli/utils";

export { FileService } from "./services/file";
export { ChunkService } from "./services/chunk";

export {
  DoclingWebSocketClient,
  WebSocketAsyncTask,
} from "./clients/websocket-client";

export {
  Docling,
  createAPIClient,
  createCLIClient,
  createWebClient,
  isAPIClient,
  isCLIClient,
  isWebClient,
  DoclingWebClient,
  type DoclingClientType,
} from "./docling";

export { AsyncTaskManager } from "./services/async-task-manager";

export type {
  DoclingConfig,
  DoclingAPIConfig,
  DoclingCLIConfig,
  DoclingClient as IDoclingClient,
  DoclingAPI,
  DoclingCLI,
  DoclingWeb,
  DoclingClientBase,
  DoclingInstance,
  ProgressConfig,
  ProgressUpdate,
  SafeConversionResult,
  SafeFileConversionResult,
} from "./types/client";

export type { DoclingAPIClient } from "./clients/api-client";
export type { DoclingCLIClient } from "./clients/cli-client";
export type DoclingAPIClientType = InstanceType<
  typeof import("./clients/api-client").DoclingAPIClient
>;

// Alias exports for common naming patterns
export type { DoclingAPI as IDoclingAPIClient } from "./types/client";
export type { DoclingCLI as IDoclingCLIClient } from "./types/client";
export type { DoclingWeb as IDoclingWebClient } from "./types/client";

// Web types
export type {
  DoclingWebClientConfig,
  DoclingWebConfig,
  WebOCRResult,
  WebOCRDocument,
  ImageInput,
  WebProcessOptions,
  WebClientEvents,
  ExtractedTable,
  ElementOverlay,
} from "./types/web";

export { ZodValidation } from "./validation/schemas";

export { default } from "./docling";
