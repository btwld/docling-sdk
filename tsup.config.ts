import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "es2022",
  outDir: "dist",
  treeshake: true,
  bundle: true,
  external: ["ws", "form-data", "cross-spawn"],
  esbuildOptions(options) {
    options.banner = {
      js: '"use strict";',
    };
  },
});
