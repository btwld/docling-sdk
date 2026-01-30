import { defineConfig } from "tsup";

export default defineConfig([
  // Main entry point - cross-runtime compatible (Node.js, Bun, Deno, Browser)
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: true,
    minify: true,
    target: "es2022",
    outDir: "dist",
    treeshake: true,
    bundle: true,
    external: ["ws", "archiver", "zod"],
    esbuildOptions(options) {
      options.banner = {
        js: '"use strict";',
      };
    },
  },
  // CLI entry point - Node.js only
  {
    entry: {
      cli: "src/cli-entry.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: false, // Don't clean since main build already did
    minify: true,
    target: "es2022",
    outDir: "dist",
    treeshake: true,
    bundle: true,
    external: ["ws", "archiver", "zod"],
    platform: "node",
    esbuildOptions(options) {
      options.banner = {
        js: '"use strict";',
      };
    },
  },
  // Browser entry point - no Node.js dependencies
  {
    entry: {
      browser: "src/browser-entry.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: false,
    sourcemap: false,
    clean: false,
    minify: true,
    target: "es2022",
    outDir: "dist",
    treeshake: true,
    bundle: true,
    external: ["zod"],
    platform: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    esbuildOptions(options) {
      options.banner = {
        js: '"use strict";',
      };
    },
    noExternal: ["ofetch", "mitt"],
  },
]);
