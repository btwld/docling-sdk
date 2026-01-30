/**
 * Bun Runtime Example
 *
 * Demonstrates Docling SDK usage in Bun environment.
 * Run: bun run examples/runtimes/bun.ts
 */
import { createAPIClient } from "docling-sdk";

const DOCLING_URL = Bun.env.DOCLING_URL || "http://localhost:5001";

async function main() {
  console.log("Docling SDK - Bun Example");
  console.log("=========================\n");

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

  // 3. Convert using Bun.file() (Bun-specific)
  console.log("3. Converting using Bun.file() (Bun only)...");
  try {
    const testFile = Bun.file("./test-document.pdf");
    const exists = await testFile.exists();

    if (exists) {
      const arrayBuffer = await testFile.arrayBuffer();
      const uint8Data = new Uint8Array(arrayBuffer);

      const fileResult = await client.convert(uint8Data, "test-document.pdf", {
        to_formats: ["text"],
      });

      console.log(`   Converted: test-document.pdf`);
      console.log(`   Content length: ${fileResult.document?.text_content?.length || 0} chars\n`);
    } else {
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

  // 5. Demonstrate Bun's fast native performance
  console.log("5. Performance benchmark (Bun native)...");
  const iterations = 100;
  const start = Bun.nanoseconds();

  for (let i = 0; i < iterations; i++) {
    const data = encoder.encode(`Document ${i}`);
    // Simulate processing without actual API calls
    new Uint8Array(data);
  }

  const elapsed = (Bun.nanoseconds() - start) / 1_000_000;
  console.log(`   ${iterations} iterations in ${elapsed.toFixed(2)}ms\n`);

  console.log("Done!");
}

main().catch(console.error);
