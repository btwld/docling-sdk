import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      "docling-sdk/web/worker": resolve(__dirname, "../../src/web/worker.ts"),
      "docling-sdk/web": resolve(__dirname, "../../src/web-entry.ts"),
      "docling-sdk": resolve(__dirname, "../../src/browser-entry.ts"),
      // Resolve peer deps from the example's node_modules (not root docling-sdk)
      "@huggingface/transformers": resolve(__dirname, "node_modules/@huggingface/transformers"),
      "onnxruntime-web": resolve(__dirname, "node_modules/onnxruntime-web"),
    },
  },
  server: {
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    fs: {
      allow: [
        // Allow serving SDK source files from repo root
        resolve(__dirname, "../.."),
      ],
    },
  },
  optimizeDeps: {
    exclude: ["@huggingface/transformers", "onnxruntime-web"],
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: resolve(__dirname, "dist"),
  },
});
