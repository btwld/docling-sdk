/**
 * Example: CLI Client Usage
 *
 * Demonstrates using the CLI client to process documents
 * via the Python Docling CLI with subprocess management.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Docling } from "../src";

async function basicCliExample() {
  console.log("🖥️ Basic CLI Client Example");

  const client = new Docling({
    cli: {
      outputDir: "./output/cli-results",
      verbose: true,
      progressBar: true,
      concurrency: 2,
    },
    timeout: 60000,
  });

  try {
    await mkdir("./output/cli-results", { recursive: true });

    // Create test document
    const testDocument = Buffer.from(`
# CLI Processing Test

This document will be processed using the Docling CLI client.

## Features
- Direct Python CLI integration
- Subprocess management
- File-based output
- Progress tracking

## Sample Content

### Tables
| Feature | Status | Notes |
|---------|--------|--------|
| CLI Integration | ✅ | Working |
| Progress Tracking | ✅ | Visual feedback |
| Error Handling | ✅ | Robust |

### Lists
1. First item
2. Second item
3. Third item
   - Sub-item A
   - Sub-item B

## Conclusion
The CLI client provides direct access to the Python Docling functionality.
    `);

    console.log("📄 Processing document with CLI client...");

    // Convert using CLI client
    const result = await client.convert(testDocument, "cli-test.md", {
      to_formats: ["md", "json", "html"],
      do_table_structure: true,
    });

    if (result.success) {
      console.log("✅ CLI processing successful!");
      
      if ("document" in result.data) {
        console.log(`📊 Document processed: ${result.data.document.filename}`);
        
        if (result.data.document.md_content) {
          console.log("📝 Markdown content available");
        }
        
        if (result.data.document.json_content) {
          console.log("🔍 JSON structure available");
        }
        
        if (result.data.document.html_content) {
          console.log("🌐 HTML content available");
        }
      } else {
        console.log("📊 CLI processing completed (presigned URL mode)");
      }
    } else {
      console.error("❌ CLI processing failed:", result.error?.message);
    }

  } catch (error) {
    console.error("💥 CLI error:", error instanceof Error ? error.message : error);
  }
}

async function cliFileProcessing() {
  console.log("\n📁 CLI File Processing Example");

  const client = new Docling({
    cli: {
      outputDir: "./output/cli-files",
      verbose: false, // Reduce verbosity for file processing
      progressBar: true,
      tempDir: "./temp",
    },
  });

  try {
    await mkdir("./output/cli-files", { recursive: true });
    await mkdir("./temp", { recursive: true });

    // Create multiple test files
    const testFiles = [
      {
        filename: "document-1.md",
        content: "# Document 1\n\nThis is the first test document.",
      },
      {
        filename: "document-2.md", 
        content: "# Document 2\n\nThis is the second test document with a table:\n\n| Col1 | Col2 |\n|------|------|\n| A    | B    |",
      },
      {
        filename: "document-3.md",
        content: "# Document 3\n\nThis is the third test document with lists:\n\n- Item 1\n- Item 2\n- Item 3",
      },
    ];

    // Save files to temp directory
    for (const file of testFiles) {
      const filePath = join("./temp", file.filename);
      await writeFile(filePath, file.content);
      console.log(`📝 Created temp file: ${filePath}`);
    }

    console.log("\n🔄 Processing files with CLI client...");

    // Process each file
    for (const file of testFiles) {
      console.log(`\n📄 Processing ${file.filename}...`);
      
      const result = await client.convertToFile(
        Buffer.from(file.content),
        file.filename,
        {
          to_formats: ["json", "html"],
          do_table_structure: true,
        }
      );

      if (result.success && result.fileStream) {
        const outputPath = join("./output/cli-files", `${file.filename}.zip`);
        const writeStream = await import("node:fs").then(fs => fs.createWriteStream(outputPath));
        
        result.fileStream.pipe(writeStream);
        
        await new Promise<void>((resolve, reject) => {
          writeStream.on('finish', () => {
            console.log(`✅ ${file.filename} processed and saved to ${outputPath}`);
            resolve();
          });
          writeStream.on('error', reject);
        });
      } else {
        console.error(`❌ Failed to process ${file.filename}:`, result.error?.message);
      }
    }

    console.log("\n✅ All files processed!");

  } catch (error) {
    console.error("💥 File processing error:", error instanceof Error ? error.message : error);
  }
}

async function cliWithProgressTracking() {
  console.log("\n📊 CLI with Progress Tracking");

  const client = new Docling({
    cli: {
      outputDir: "./output/cli-progress",
      verbose: false,
      progressBar: false, // Disable built-in progress bar to use custom one
    },
    progress: {
      onProgress: (progress) => {
        const percentage = progress.percentage ?? 0;
        const stage = progress.stage || "processing";
        const progressBar = "█".repeat(Math.floor(percentage / 5)) + "░".repeat(20 - Math.floor(percentage / 5));
        
        process.stdout.write(`\r🔄 CLI ${stage}: [${progressBar}] ${percentage.toFixed(1)}%`);
      },
      onComplete: () => {
        console.log("\n✅ CLI processing completed with progress tracking!");
      },
      onError: (error) => {
        console.error("\n❌ CLI progress error:", error.message);
      },
    },
  });

  try {
    await mkdir("./output/cli-progress", { recursive: true });

    const testDocument = Buffer.from(`
# Progress Tracking Test

This document tests progress tracking with the CLI client.

## Content Sections
### Section 1
Lorem ipsum dolor sit amet, consectetur adipiscing elit.

### Section 2  
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

### Section 3
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

| Progress | Status |
|----------|--------|
| Parsing  | ✅     |
| Analysis | ✅     |
| Output   | ✅     |
    `);

    console.log("🚀 Starting CLI processing with progress tracking...");

    const result = await client.convert(testDocument, "progress-test.md", {
      to_formats: ["md", "json"],
      do_table_structure: true,
    });

    console.log(); // New line after progress bar

    if (result.success) {
      console.log("🎯 CLI processing with progress tracking successful!");
    } else {
      console.error("❌ CLI processing failed:", result.error?.message);
    }

  } catch (error) {
    console.error("\n💥 Progress tracking error:", error instanceof Error ? error.message : error);
  }
}

async function cliConvenienceMethods() {
  console.log("\n🛠️ CLI Convenience Methods");

  const client = new Docling({
    cli: {
      outputDir: "./output/cli-convenience",
      verbose: false,
    },
  });

  try {
    await mkdir("./output/cli-convenience", { recursive: true });

    const testDocument = Buffer.from("# Convenience Test\n\nTesting CLI convenience methods.");

    // Text extraction
    console.log("📝 Extracting text with CLI...");
    const textResult = await client.extractText(testDocument, "convenience-test.md");
    if (textResult.success) {
      console.log("✅ CLI text extraction successful");
    }

    // HTML conversion
    console.log("🌐 Converting to HTML with CLI...");
    const htmlResult = await client.toHtml(testDocument, "convenience-test.md");
    if (htmlResult.success) {
      console.log("✅ CLI HTML conversion successful");
    }

    // Markdown conversion
    console.log("📝 Converting to Markdown with CLI...");
    const mdResult = await client.toMarkdown(testDocument, "convenience-test.md");
    if (mdResult.success) {
      console.log("✅ CLI Markdown conversion successful");
    }

    console.log("✅ All CLI convenience methods tested!");

  } catch (error) {
    console.error("💥 Convenience methods error:", error instanceof Error ? error.message : error);
  }
}

async function cliErrorHandling() {
  console.log("\n⚠️ CLI Error Handling Example");

  const client = new Docling({
    cli: {
      outputDir: "./output/cli-errors",
      verbose: true, // Enable verbose for error debugging
    },
    timeout: 5000, // Short timeout to test timeout handling
  });

  try {
    // Test with potentially problematic content
    const problematicDocument = Buffer.from(""); // Empty document

    console.log("🔍 Testing error handling with empty document...");

    const result = await client.convert(problematicDocument, "empty.md", {
      to_formats: ["md"],
    });

    if (result.success) {
      console.log("✅ Empty document handled successfully");
    } else {
      console.log("⚠️ Expected error occurred:", result.error?.message);
      console.log("🔧 Error handling working correctly");
    }

  } catch (error) {
    console.log("⚠️ Exception caught (this is expected):", error instanceof Error ? error.message : error);
    console.log("🔧 Exception handling working correctly");
  }
}

async function main() {
  console.log("🖥️ Docling SDK - CLI Client Examples");
  console.log("===================================");
  
  console.log("📋 Note: CLI examples require Python Docling to be installed");
  console.log("   Install with: pip install docling");
  console.log();

  await basicCliExample();
  await cliFileProcessing();
  await cliWithProgressTracking();
  await cliConvenienceMethods();
  await cliErrorHandling();
  
  console.log("\n🎉 All CLI client examples completed!");
  console.log("📁 Check the ./output directory for generated files");
}

if (require.main === module) {
  main().catch(console.error);
}

export { 
  basicCliExample,
  cliFileProcessing,
  cliWithProgressTracking,
  cliConvenienceMethods,
  cliErrorHandling,
  main 
};
