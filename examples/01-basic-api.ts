/**
 * Example: Basic API Usage with API Key
 *
 * Demonstrates basic document conversion using the Docling API client
 * with API key authentication support.
 */

import { readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Docling } from "../src";

async function basicApiExample() {
  console.log("🚀 Starting Basic API Example with API Key");

  // Configuration with API key
  const baseUrl = process.env.DOCLING_URL || "http://localhost:5001";
  const apiKey = process.env.DOCLING_API_KEY; // Optional API key

  const client = new Docling({
    api: {
      baseUrl,
      apiKey, // API key will be sent as X-Api-Key header
      timeout: 180000, // 3 minutes for large PDFs
      retries: 3,
    },
  });

  try {
    // 1. Health Check
    console.log("📊 Checking service health...");
    const health = await client.health();
    console.log("✅ Service status:", health.status);

    // 2. Simple document conversion (in-body JSON response)
    console.log("\n📄 Converting document to Markdown...");
    
    // Use a real PDF document from uploads folder
    let testDocument: Buffer;
    try {
      testDocument = await readFile("./uploads/IRS_Notice_CP501.pdf");
      console.log(`📏 Using real PDF: ${(testDocument.length / 1024).toFixed(2)} KB`);
    } catch {
      // Fallback to test content if file not found
      testDocument = Buffer.from("# Test Document\n\nThis is a test document for Docling conversion.");
      console.log("📄 Using fallback test content");
    }
    
    const result = await client.convert(testDocument, "IRS_Notice_CP501.pdf", {
      to_formats: ["json", "html"],
      do_table_structure: true,
      do_picture_description: true,
    });

    // ✨ NEW: Clean, ergonomic API - no nested type guards needed!
    if (result.success) {
      console.log("✅ Conversion successful!");
      console.log("📊 Document info:");
      
      // TypeScript automatically knows result.data.document exists!
      // No more "result.data is possibly undefined" errors
      // No more manual "document" in result.data checks
      console.log(`  - Filename: ${result.data.document.filename}`);
      console.log(`  - Content available: ${result.data.document.json_content ? 'Yes' : 'No'}`);
      
      if (result.data.document.json_content) {
        console.log(`  - JSON content length: ${JSON.stringify(result.data.document.json_content).length} characters`);
      }
      if (result.data.document.html_content) {
        console.log(`  - HTML content length: ${result.data.document.html_content.length} characters`);
      }
    } else {
      // TypeScript automatically knows result.error exists!
      // No more "result.error is possibly undefined" errors  
      console.error("❌ Conversion failed:", result.error.message);
      return;
    }

    // 3. File conversion (ZIP response)
    console.log("\n📦 Converting to downloadable files...");
    const fileResult = await client.convertToFile(testDocument, "IRS_Notice_CP501.pdf", {
      to_formats: ["md", "json", "html"],
      do_table_structure: true,
    });

    if (fileResult.success && fileResult.fileStream) {
      const outputFile = "./output/basic-example-result.zip";
      const writeStream = createWriteStream(outputFile);
      
      fileResult.fileStream.pipe(writeStream);
      
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', () => {
          console.log(`✅ Files saved to: ${outputFile}`);
          resolve();
        });
        writeStream.on('error', reject);
      });
    } else {
      console.error("❌ File conversion failed:", fileResult.error?.message);
    }

  } catch (error) {
    console.error("💥 Error:", error instanceof Error ? error.message : error);
  }
}

async function convenienceMethods() {
  console.log("\n🛠️ Testing Convenience Methods");
  
  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 30000,
    },
  });

  const testDocument = Buffer.from("# Test Document\n\nThis is a test document.");

  try {
    // Text extraction  
    console.log("📝 Extracting text...");
    const textResult = await client.extractText(testDocument, "test.md");
    if (textResult.success) {
      console.log("✅ Text extracted successfully");
      // TypeScript knows textResult.data.document exists!
    }

    // HTML conversion
    console.log("🌐 Converting to HTML...");
    const htmlResult = await client.toHtml(testDocument, "test.md", {
      do_picture_description: true,
    });
    if (htmlResult.success) {
      console.log("✅ HTML conversion successful");
      // TypeScript knows htmlResult.data.document exists!
    }

    // Markdown conversion
    console.log("📝 Converting to Markdown...");
    const mdResult = await client.toMarkdown(testDocument, "test.md");
    if (mdResult.success) {
      console.log("✅ Markdown conversion successful");
      // TypeScript knows mdResult.data.document exists!
    }

  } catch (error) {
    console.error("💥 Convenience methods error:", error instanceof Error ? error.message : error);
  }
}

async function main() {
  console.log("🔧 Docling SDK - Basic API Example");
  console.log("==================================");
  
  if (!process.env.DOCLING_URL) {
    console.log("💡 Using default URL: http://localhost:5001");
    console.log("   Set DOCLING_URL environment variable to use different URL");
  }
  
  if (!process.env.DOCLING_API_KEY) {
    console.log("🔓 No API key provided");
    console.log("   Set DOCLING_API_KEY environment variable if required");
  } else {
    console.log("🔐 API key configured");
  }

  await basicApiExample();
  await convenienceMethods();
  
  console.log("\n✅ Basic API example completed!");
}

if (require.main === module) {
  main().catch(console.error);
}

export { basicApiExample, convenienceMethods, main };
