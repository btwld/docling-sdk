import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: false, // Exclude source maps from build
  clean: true,
  minify: true, // Enable minification for smaller output
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
});
