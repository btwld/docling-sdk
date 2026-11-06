/** Optional Node-only Rust backend. No native code, models, or installation on import. */
export { createNativeClient } from "./native/client";
export type { NativeClient } from "./native/client";
export { nativeRuntimeManifest } from "./native/profile";
export { NativeError } from "./native/types";
export type {
  NativeAsset,
  NativeClientConfig,
  NativeConversionResult,
  NativeConvertOptions,
  NativeErrorCode,
  NativeFormat,
  NativeInputFormat,
  NativeOutputFile,
  NativePageCoverage,
  NativeRuntimeIdentity,
  NativeRuntimeManifest,
} from "./native/types";
