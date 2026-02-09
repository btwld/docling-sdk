import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      "docling-sdk": resolve(__dirname, "../../../src/browser-entry.ts"),
      "docling-sdk/browser": resolve(__dirname, "../../../src/browser-entry.ts"),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: resolve(__dirname, "../../../dist/browser-example"),
  },
});
