import { createReadStream } from "node:fs";
import { join } from "node:path";
import { Docling } from "../src";

/**
 * Minimal NestJS-like handler that converts an incoming file stream and pipes
 * the returned ZIP stream directly to S3 without buffering.
 *
 * Notes:
 * - This example demonstrates the streaming capability without actual S3 upload
 * - In a real app, you would use AWS SDK v3: @aws-sdk/client-s3
 * - Body for PutObjectCommand accepts a Node.js Readable directly.
 */

async function main() {
  console.log("🚀 Starting NestJS S3 ZIP stream example");

  const baseUrl = process.env.DOCLING_URL || "http://localhost:5001";
  const client = new Docling({ api: { baseUrl, timeout: 120000 } });

  console.log("📄 Reading input file...");
  // Simulate an incoming stream (replace with NestJS req/file stream)
  const inputPath = join(process.cwd(), "examples", "example.pdf");
  const input = createReadStream(inputPath);

  console.log("🔄 Converting stream to ZIP file...");

  try {
    const zip = await client.convertStreamToFile(input, "example.pdf", {
      to_formats: ["md", "json"],
    });

    if (!zip.success || !zip.fileStream) {
      throw new Error(zip.error?.message || "ZIP stream not available");
    }

    console.log("✅ ZIP stream created successfully");
    console.log("📤 Simulating S3 upload (consuming stream)...");

    // In a real app, you would pipe this stream directly to S3:
    // await s3.send(new PutObjectCommand({
    //   Bucket: bucket,
    //   Key: key,
    //   Body: zip.fileStream
    // }));

    let totalBytes = 0;
    zip.fileStream.on("data", (chunk) => {
      totalBytes += chunk.length;
    });

    zip.fileStream.on("end", () => {
      console.log(`✅ Stream consumed successfully (${totalBytes} bytes)`);
      console.log("🎉 NestJS S3 ZIP streaming demo complete!");
      console.log(
        "💡 In production, this stream would be uploaded directly to S3"
      );
    });

    zip.fileStream.on("error", (error) => {
      console.error("❌ Stream error:", error);
    });
  } catch (error) {
    console.error("❌ Error during stream conversion:", error);
    throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
