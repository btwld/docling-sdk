/** Node-only capabilities stay lazy so browser bundlers need no Node shims. */
interface NodeModules {
  "node:fs": typeof import("node:fs");
  "node:fs/promises": typeof import("node:fs/promises");
  "node:path": typeof import("node:path");
  "node:stream": typeof import("node:stream");
  "node:stream/promises": typeof import("node:stream/promises");
  "node:buffer": typeof import("node:buffer");
  ws: typeof import("ws");
}

export function loadNodeModule<K extends keyof NodeModules>(name: K): Promise<NodeModules[K]> {
  // A runtime specifier prevents bundlers from resolving optional Node modules
  // on browser paths. Callers select this capability only when it is needed.
  return import(/* @vite-ignore */ name);
}
