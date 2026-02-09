#!/usr/bin/env tsx
/**
 * Fetch OpenAPI spec from Docling Serve
 *
 * Usage:
 *   npm run openapi:fetch                          # Uses default URL (http://localhost:5000)
 *   npm run openapi:fetch -- --url http://custom:5000
 *   DOCLING_URL=http://custom:5000 npm run openapi:fetch
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_URL = "http://localhost:5000";
const OUTPUT_PATH = "openapi/docling-serve.yaml";

async function fetchOpenAPISpec(): Promise<void> {
  // Parse CLI args for --url flag
  const args = process.argv.slice(2);
  const urlFlagIndex = args.indexOf("--url");
  const cliUrl = urlFlagIndex !== -1 ? args[urlFlagIndex + 1] : undefined;

  // Priority: CLI arg > env var > default
  const baseUrl = cliUrl || process.env.DOCLING_URL || DEFAULT_URL;

  // Try both /openapi.json and /openapi.yaml endpoints
  const endpoints = ["/openapi.json", "/openapi.yaml", "/docs/openapi.json", "/docs/openapi.yaml"];

  console.log(`Fetching OpenAPI spec from ${baseUrl}...`);

  let spec: string | null = null;
  let usedEndpoint: string | null = null;

  for (const endpoint of endpoints) {
    const url = `${baseUrl}${endpoint}`;
    try {
      console.log(`  Trying ${url}...`);
      const response = await fetch(url);

      if (response.ok) {
        spec = await response.text();
        usedEndpoint = endpoint;
        console.log(`  ✓ Found spec at ${endpoint}`);
        break;
      }
    } catch {
      // Continue to next endpoint
    }
  }

  if (!spec || !usedEndpoint) {
    console.error("\n✗ Could not fetch OpenAPI spec from any endpoint.");
    console.error("  Make sure Docling Serve is running at:", baseUrl);
    console.error("\n  Tried endpoints:", endpoints.join(", "));
    console.error("\n  You can specify a custom URL:");
    console.error("    npm run openapi:fetch -- --url http://your-server:port");
    console.error("    DOCLING_URL=http://your-server:port npm run openapi:fetch");
    process.exit(1);
  }

  // Convert JSON to YAML if needed (simple conversion for storage)
  let outputContent = spec;
  if (usedEndpoint.endsWith(".json")) {
    try {
      // Keep as JSON but pretty-print it
      const parsed = JSON.parse(spec);
      outputContent = JSON.stringify(parsed, null, 2);
      // Update output path to .json
      const jsonOutputPath = OUTPUT_PATH.replace(".yaml", ".json");
      mkdirSync(dirname(jsonOutputPath), { recursive: true });
      writeFileSync(jsonOutputPath, outputContent, "utf-8");
      console.log(`\n✓ Saved OpenAPI spec to ${jsonOutputPath}`);
      console.log("\nNext steps:");
      console.log(
        `  npm run openapi:generate  # Generate TypeScript types from ${jsonOutputPath}`
      );
      return;
    } catch {
      // If JSON parsing fails, save as-is
    }
  }

  // Save the spec
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, outputContent, "utf-8");
  console.log(`\n✓ Saved OpenAPI spec to ${OUTPUT_PATH}`);
  console.log("\nNext steps:");
  console.log(`  npm run openapi:generate  # Generate TypeScript types from ${OUTPUT_PATH}`);
}

fetchOpenAPISpec().catch((error) => {
  console.error("Error fetching OpenAPI spec:", error);
  process.exit(1);
});
