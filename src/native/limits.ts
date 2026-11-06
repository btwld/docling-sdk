/** Deliberately bounded first-profile contract, not arbitrary CLI option forwarding. */
export const NATIVE_LIMITS = Object.freeze({
  inputBytes: 50 * 1024 * 1024,
  outputBytes: 128 * 1024 * 1024,
  outputFiles: 256,
  archiveEntries: 10000,
  archiveBytes: 256 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024,
  maxPages: 10000,
  maxTimeoutMs: 15 * 60 * 1000,
  defaultTimeoutMs: 120000,
  diagnosticBytes: 2 * 1024 * 1024,
});
