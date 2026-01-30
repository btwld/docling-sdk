/**
 * Deno Runtime Example
 *
 * Demonstrates Docling SDK usage in Deno environment.
 * Run: deno run --allow-net --allow-env --allow-read examples/runtimes/deno.ts
 *
 * Note: Requires npm specifier for importing from npm packages
 */

// Import using npm: specifier for Deno
// In production, you would use: import { createAPIClient } from "npm:docling-sdk";
// For local development, use the relative path:
import { createAPIClient } from "../../src/docling.ts";

const DOCLING_URL = Deno.env.get("DOCLING_URL") || "http://localhost:5001";

async function main() {
  console.log("Docling SDK - Deno Example");
  console.log("==========================\n");

  // Create API client
  const client = createAPIClient(DOCLING_URL, {
    timeout: 60000,
    retries: 3,
  });

  // 1. Health check
  console.log("1. Checking API health...");
  const health = await client.health();
  console.log(`   Status: ${health.status}`);
  console.log(`   Version: ${health.version || "N/A"}\n`);

  // 2. Convert from URL
  console.log("2. Converting document from URL...");
  const pdfUrl = "https://arxiv.org/pdf/2408.09869";

  const result = await client.convertFromUrl(pdfUrl, {
    to_formats: ["md"],
  });

  console.log(`   Source: ${result.document?.source?.filename || pdfUrl}`);
  console.log(`   Format: markdown`);

  const mdContent = result.document?.md_content || "";
  console.log(`   Content length: ${mdContent.length} characters`);
  console.log(`   Preview: ${mdContent.slice(0, 200).replace(/\n/g, " ")}...\n`);

  // 3. Convert using Deno.readFile() (Deno-specific)
  console.log("3. Converting using Deno.readFile() (Deno only)...");
  try {
    const testFile = "./test-document.pdf";

    // Check if file exists using Deno.stat
    try {
      await Deno.stat(testFile);
      const uint8Data = await Deno.readFile(testFile);

      const fileResult = await client.convert(uint8Data, "test-document.pdf", {
        to_formats: ["text"],
      });

      console.log(`   Converted: ${testFile}`);
      console.log(`   Content length: ${fileResult.document?.text_content?.length || 0} chars\n`);
    } catch {
      console.log("   Skipped: No test-document.pdf found in current directory\n");
    }
  } catch (error) {
    console.log(`   Error: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  }

  // 4. Convert from Uint8Array (cross-runtime compatible)
  console.log("4. Converting from Uint8Array (cross-runtime)...");
  const textContent = "# Sample Document\n\nThis is a test document.";
  const encoder = new TextEncoder();
  const uint8Data = encoder.encode(textContent);

  const bufferResult = await client.convert(uint8Data, "sample.md", {
    to_formats: ["text"],
  });

  console.log(`   Input: ${uint8Data.length} bytes`);
  console.log(
    `   Output: ${bufferResult.document?.text_content?.length || 0} characters\n`
  );

  // 5. Demonstrate Deno's built-in permissions
  console.log("5. Deno permissions info...");
  console.log("   Required permissions:");
  console.log("   - --allow-net (for API calls)");
  console.log("   - --allow-env (for DOCLING_URL)");
  console.log("   - --allow-read (for local files)\n");

  // 6. Deno's native fetch (used internally)
  console.log("6. Using Deno's native fetch...");
  console.log("   Docling SDK uses native fetch when available");
  console.log("   Deno provides native Web APIs out of the box\n");

  console.log("Done!");
}

// Deno entry point
if (import.meta.main) {
  main().catch(console.error);
}
