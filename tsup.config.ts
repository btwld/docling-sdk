import { defineConfig } from "tsup";

export default defineConfig([
  // Main entries with code splitting - cross-runtime (Node.js, Bun, Deno, Browser)
  {
    entry: {
      index: "src/index.ts",
      cli: "src/cli-entry.ts",
      browser: "src/browser-entry.ts",
    },
    format: ["esm"],
    dts: false,
    splitting: true,
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
      options.legalComments = "none";
      options.drop = ["console", "debugger"];
    },
  },
  // Web entry point - browser-based OCR (ESM only)
  {
    entry: {
      web: "src/web-entry.ts",
    },
    format: ["esm"],
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    minify: true,
    target: "es2022",
    outDir: "dist",
    treeshake: true,
    bundle: true,
    external: ["zod", "@huggingface/transformers", "onnxruntime-web", "unpdf"],
    platform: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    esbuildOptions(options) {
      options.banner = {
        js: '"use strict";',
      };
      options.legalComments = "none";
      options.drop = ["console", "debugger"];
    },
    noExternal: ["ofetch", "mitt"],
  },
  // Web Worker - separate bundle for model inference (ESM only)
  {
    entry: {
      "web-worker": "src/web/worker.ts",
    },
    format: ["esm"],
    dts: false,
    splitting: false,
    sourcemap: false,
    clean: false,
    minify: true,
    target: "es2022",
    outDir: "dist",
    treeshake: true,
    bundle: true,
    external: ["@huggingface/transformers", "onnxruntime-web"],
    platform: "browser",
    esbuildOptions(options) {
      options.banner = {
        js: '"use strict";',
      };
      options.legalComments = "none";
      options.drop = ["console", "debugger"];
    },
  },
]);
