import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{js,ts}"],
    exclude: ["node_modules", "dist", ".examples"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        ".examples/",
        "tests/",
        "**/*.d.ts",
        "**/*.config.{js,ts}",
        "**/index.ts",
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/types": resolve(__dirname, "./src/types"),
      "@/cli": resolve(__dirname, "./src/cli"),
      "@/api": resolve(__dirname, "./src/api"),
      "@/utils": resolve(__dirname, "./src/utils"),
      "@/websocket": resolve(__dirname, "./src/websocket"),
    },
  },
});
