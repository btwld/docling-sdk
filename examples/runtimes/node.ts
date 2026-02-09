/**
 * Node.js Runtime Example
 *
 * Demonstrates Docling SDK usage in Node.js environment.
 * Run: npx tsx examples/runtimes/node.ts
 */
import { createAPIClient } from "docling-sdk";

const DOCLING_URL = process.env.DOCLING_URL || "http://localhost:5001";

async function main() {
  console.log("Docling SDK - Node.js Example");
  console.log("=============================\n");

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

  // 3. Convert from file (Node.js specific)
  console.log("3. Converting from local file (Node.js only)...");
  try {
    // This demonstrates the Node.js-specific file path feature
    // In other runtimes, you would need to read the file first and pass Uint8Array
    const fs = await import("node:fs/promises");
    const testFile = "./test-document.pdf";

    // Check if test file exists
    try {
      await fs.access(testFile);
      const fileResult = await client.convertFromFile(testFile, {
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

  console.log("Done!");
}

main().catch(console.error);
