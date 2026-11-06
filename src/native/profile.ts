import profile from "./profile.json";
import type { NativeRuntimeManifest } from "./types";

function freeze(value: unknown): void {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
}
freeze(profile);

// Versioned data is bundled only into the native entry; no executable or models ship in npm.
export const nativeRuntimeManifest: NativeRuntimeManifest = profile as NativeRuntimeManifest;
