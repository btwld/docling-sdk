/** The first native profile is deliberately narrower than the existing client API. */
export type NativeFormat = "md" | "json";
export type NativeInputFormat = "pdf" | "docx" | "pptx";

export interface NativeAsset {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly url: string;
  readonly license: string;
}

/** Reviewed configuration, not a request to fetch or install anything. */
export interface NativeRuntimeManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly engine: {
    readonly name: "docling-rs";
    readonly version: string;
    readonly commit: string;
  };
  readonly platform: "linux";
  readonly architecture: "x64";
  readonly minimumGlibc: string;
  readonly executable: {
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
    readonly license: string;
    readonly archive: { readonly url: string; readonly size: number; readonly sha256: string };
  };
  readonly assets: readonly NativeAsset[];
}

export interface NativeClientConfig {
  executable: string;
  modelDirectory: string;
  /** Defaults to the bundled reviewed manifest; unreviewed manifests are rejected. */
  manifest?: NativeRuntimeManifest;
  /** Absolute path to the administrator-provided Bubblewrap installation. */
  bubblewrapPath?: string;
}

export interface NativeConvertOptions {
  outputDirectory: string;
  formats?: readonly NativeFormat[];
  signal?: AbortSignal;
  /** Whole-operation deadline, including verification and cleanup; default 120000 ms. */
  timeoutMs?: number;
  /** Inclusive, one-based PDF page range. Not supported for Office inputs. */
  pageRange?: readonly [number, number];
  /** Upstream PDF budget; may return a partial document. Not a hard process deadline. */
  documentTimeoutSeconds?: number;
}

export interface NativeRuntimeIdentity {
  profile: string;
  engine: "docling-rs";
  version: string;
  commit: string;
  platform: "linux-x64";
  executableSha256: string;
  manifestSha256: string;
  isolation: "bubblewrap";
}

export interface NativeOutputFile {
  /** Relative to result.outputDirectory, never an arbitrary converter-reported path. */
  path: string;
  kind: NativeFormat | "asset";
  size: number;
  sha256: string;
}

export interface NativePageCoverage {
  /** Native converter's structural report, not proof of OCR or extraction quality. */
  basis: "engine-reported" | "office-package" | "not-reported";
  requested?: readonly [number, number];
  expected?: number;
  completed: number[];
  complete?: boolean;
}

export interface NativeConversionResult {
  status: "success" | "partial_success" | "failure";
  /** Absent when no validated output was published. */
  outputDirectory?: string;
  files: NativeOutputFile[];
  /** Unmodified parsed upstream JSON, present only when JSON was requested and validated. */
  document?: Record<string, unknown>;
  input: { filename: string; format: NativeInputFormat; size: number; sha256: string };
  coverage: NativePageCoverage;
  warnings: string[];
  runtime: NativeRuntimeIdentity;
}

export type NativeErrorCode =
  | "UNSUPPORTED_PLATFORM"
  | "INVALID_CONFIGURATION"
  | "RUNTIME_UNAVAILABLE"
  | "RUNTIME_INTEGRITY"
  | "ISOLATION_UNAVAILABLE"
  | "INVALID_INPUT"
  | "INVALID_OUTPUT"
  | "EXECUTION_FAILED"
  | "ABORTED"
  | "TIMEOUT";

export class NativeError extends Error {
  constructor(
    public readonly code: NativeErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "NativeError";
  }
}
