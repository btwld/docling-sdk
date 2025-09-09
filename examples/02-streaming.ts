/**
 * Example: Streaming Document Processing
 *
 * Demonstrates streaming capabilities for memory-efficient processing
 * of large documents with progress tracking.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Docling } from "../src";

async function streamingExample() {
  console.log("🌊 Starting Streaming Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
      retries: 2,
    },
  });

  try {
    await mkdir("./output", { recursive: true });

    const largeTestContent = Array(1000)
      .fill(
        `
# Chapter ${Math.random()}

This is a large test document that demonstrates streaming capabilities.
It contains multiple sections and enough content to show progress tracking.

## Section A
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Section B  
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

## Tables
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data 1   | Data 2   | Data 3   |
| Data 4   | Data 5   | Data 6   |

## Lists
- Item 1
- Item 2
- Item 3
  - Nested item
  - Another nested item
    `
      )
      .join("\n");

    const testBuffer = Buffer.from(largeTestContent);
    console.log(
      `📏 Test document size: ${(testBuffer.length / 1024).toFixed(2)} KB`
    );

    console.log("\n📤 Streaming conversion to Markdown file...");
    const outputStream = createWriteStream("./output/streamed-output.md");

    await client.convertToStream(testBuffer, "large-doc.md", outputStream, {
      to_formats: ["md"],
      do_table_structure: true,
      do_picture_description: false,
    });

    console.log("✅ Markdown streaming completed!");

    console.log("\n📦 Streaming conversion to ZIP file...");
    const zipResult = await client.convertStreamToFile(
      createReadStream(Buffer.from(testBuffer)), // Simulate file stream
      "large-doc.md",
      {
        to_formats: ["md", "json", "html"],
        do_table_structure: true,
      }
    );

    if (zipResult.success && zipResult.fileStream) {
      const zipOutput = createWriteStream("./output/streamed-result.zip");
      zipResult.fileStream.pipe(zipOutput);

      await new Promise<void>((resolve, reject) => {
        zipOutput.on("finish", () => {
          console.log("✅ ZIP streaming completed!");
          resolve();
        });
        zipOutput.on("error", reject);
      });
    } else {
      console.error("❌ ZIP streaming failed:", zipResult.error?.message);
    }
  } catch (error) {
    console.error(
      "💥 Streaming error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function progressTrackingExample() {
  console.log("\n📊 Progress Tracking Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
    progress: {
      method: "websocket", // Use WebSocket for real-time progress
      onProgress: (progress) => {
        const percentage = progress.percentage ?? 0;
        const stage = progress.stage || "processing";
        const progressBar =
          "█".repeat(Math.floor(percentage / 5)) +
          "░".repeat(20 - Math.floor(percentage / 5));

        process.stdout.write(
          `\r📊 ${stage}: [${progressBar}] ${percentage.toFixed(1)}%`
        );

        if (progress.uploadedBytes && progress.totalBytes) {
          const speed = progress.bytesPerSecond
            ? `${(progress.bytesPerSecond / 1024).toFixed(2)} KB/s`
            : "N/A";
          process.stdout.write(` | ${speed}`);
        }
      },
      onComplete: (result) => {
        console.log("\n✅ Processing completed!");
      },
      onError: (error) => {
        console.error("\n❌ Progress error:", error.message);
      },
    },
  });

  try {
    const testDocument = Buffer.from(
      "# Progress Test\n\nThis document tests progress tracking."
    );

    console.log("🚀 Starting conversion with progress tracking...");

    const result = await client.convert(testDocument, "progress-test.md", {
      to_formats: ["md", "json"],
      do_table_structure: true,
    });

    console.log(); // New line after progress bar

    if (result.success) {
      console.log("✅ Conversion with progress tracking successful!");
    } else {
      console.error("❌ Conversion failed:", result.error?.message);
    }
  } catch (error) {
    console.error(
      "\n💥 Progress tracking error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function memoryEfficientProcessing() {
  console.log("\n🧠 Memory Efficient Processing Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
  });

  try {
    const documents = Array.from({ length: 5 }, (_, i) => ({
      filename: `document-${i + 1}.md`,
      content: Buffer.from(
        `# Document ${i + 1}\n\nContent for document ${
          i + 1
        } with some data to process.`
      ),
    }));

    console.log(
      `📚 Processing ${documents.length} documents with streaming...`
    );

    for (const doc of documents) {
      console.log(`\n🔄 Processing ${doc.filename}...`);

      const outputPath = join("./output", `processed-${doc.filename}.json`);

      // Use streaming to avoid loading everything into memory
      const result = await client.convert(doc.content, doc.filename, {
        to_formats: ["json"],
        do_table_structure: false, // Faster processing
      });

      if (
        result.success &&
        "document" in result.data &&
        result.data.document.json_content
      ) {
        await writeFile(
          outputPath,
          JSON.stringify(result.data.document.json_content, null, 2)
        );
        console.log(`✅ ${doc.filename} processed and saved to ${outputPath}`);
      } else {
        console.error(`❌ Failed to process ${doc.filename}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log("\n✅ Batch processing completed!");
  } catch (error) {
    console.error(
      "💥 Memory efficient processing error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function main() {
  console.log("🌊 Docling SDK - Streaming Examples");
  console.log("===================================");

  if (!process.env.DOCLING_URL) {
    console.log("💡 Using default URL: http://localhost:5001");
  }

  if (!process.env.DOCLING_API_KEY) {
    console.log("🔓 No API key provided (may be optional)");
  } else {
    console.log("🔐 API key configured");
  }

  await streamingExample();
  await progressTrackingExample();
  await memoryEfficientProcessing();

  console.log("\n🎉 All streaming examples completed!");
}

if (require.main === module) {
  main().catch(console.error);
}

export {
  streamingExample,
  progressTrackingExample,
  memoryEfficientProcessing,
  main,
};
