/**
 * Example: Quick Start Chunking
 *
 * Simple examples showing how to get started with document chunking.
 */

import { readFile } from "node:fs/promises";
import { Docling } from "../src";

async function quickChunkExample() {
  console.log("⚡ Quick Chunking Example");

  // Initialize client
  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
    },
  });

  // Sample document content
  const document = Buffer.from(`# Sample Document

## Introduction
This is a sample document for chunking demonstration.

## Main Content
Here we have the main content of the document with multiple paragraphs.

This paragraph contains important information that should be preserved in chunks.

## Technical Details
Some technical information with code examples:

\`\`\`python
def process_chunks(chunks):
    for chunk in chunks:
        print(chunk.text)
\`\`\`

## Conclusion
Final thoughts and summary of the document.
`);

  try {
    // 1. Basic HybridChunker usage
    console.log("🔗 Using HybridChunker...");
    const hybridChunks = await client.chunkHybridSync(
      document,
      "sample.md",
      {
        chunking_max_tokens: 100,
        chunking_include_raw_text: true,
      }
    );

    console.log(`✅ Created ${hybridChunks.chunks.length} chunks`);
    hybridChunks.chunks.forEach((chunk, i) => {
      console.log(`  Chunk ${i + 1}: ${chunk.text.slice(0, 50)}...`);
    });

    // 2. Basic HierarchicalChunker usage
    console.log("\n📊 Using HierarchicalChunker...");
    const hierarchicalChunks = await client.chunkHierarchicalSync(
      document,
      "sample.md"
    );

    console.log(`✅ Created ${hierarchicalChunks.chunks.length} chunks`);
    hierarchicalChunks.chunks.forEach((chunk, i) => {
      console.log(`  Chunk ${i + 1}: ${chunk.text.slice(0, 50)}...`);
    });

    // 3. Async chunking with progress
    console.log("\n🔄 Async chunking with progress...");
    const task = await client.chunkHybridFileAsync({
      files: document,
      filename: "sample.md",
      chunking_max_tokens: 150,
    });

    task.on("progress", (status) => {
      console.log(`📊 Status: ${status.task_status}`);
    });

    const result = await task.waitForCompletion();
    const finalChunks = await task.getResult();
    
    console.log(`✅ Async chunking completed: ${finalChunks.chunks.length} chunks`);

  } catch (error) {
    console.error("❌ Error:", error);
  }
}

async function chunkPDFExample() {
  console.log("\n📄 PDF Chunking Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
    },
  });

  try {
    // Try to read a PDF file
    const pdfBuffer = await readFile("./examples/example.pdf");
    
    console.log("📄 Chunking PDF document...");
    const chunks = await client.chunkHybridSync(
      pdfBuffer,
      "example.pdf",
      {
        chunking_max_tokens: 200,
        chunking_use_markdown_tables: true,
        chunking_include_raw_text: false,
      }
    );

    console.log(`✅ PDF chunked into ${chunks.chunks.length} pieces`);
    console.log(`⏱️  Processing time: ${chunks.processing_time}s`);

    // Show chunk details
    chunks.chunks.slice(0, 3).forEach((chunk, i) => {
      console.log(`\nChunk ${i + 1}:`);
      console.log(`  Page(s): ${chunk.page_numbers?.join(", ") || "N/A"}`);
      console.log(`  Headings: ${chunk.headings?.join(" > ") || "None"}`);
      console.log(`  Text: ${chunk.text.slice(0, 100)}...`);
    });

  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      console.log("📄 No example.pdf found, skipping PDF example");
    } else {
      console.error("❌ PDF chunking error:", error);
    }
  }
}

async function chunkFromURLExample() {
  console.log("\n🌐 URL Chunking Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
    },
  });

  try {
    console.log("🌐 Chunking document from URL...");
    
    const result = await client.chunkHybridSource({
      sources: [
        {
          kind: "http",
          url: "https://raw.githubusercontent.com/DS4SD/docling/main/README.md",
        },
      ],
      chunking_options: {
        max_tokens: 250,
        use_markdown_tables: true,
      },
    });

    console.log(`✅ URL document chunked into ${result.chunks.length} pieces`);
    console.log(`⏱️  Processing time: ${result.processing_time}s`);

    // Show first few chunks
    result.chunks.slice(0, 2).forEach((chunk, i) => {
      console.log(`\nChunk ${i + 1}:`);
      console.log(`  Headings: ${chunk.headings?.join(" > ") || "None"}`);
      console.log(`  Text: ${chunk.text.slice(0, 120)}...`);
    });

  } catch (error) {
    console.error("❌ URL chunking error:", error);
  }
}

async function customChunkingOptions() {
  console.log("\n⚙️  Custom Chunking Options Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
    },
  });

  const document = Buffer.from(`# Configuration Guide

## Basic Setup
Start with the basic configuration options.

## Advanced Settings
| Setting | Value | Description |
|---------|-------|-------------|
| max_tokens | 200 | Maximum tokens per chunk |
| merge_peers | true | Merge small adjacent chunks |
| use_tables | true | Include table formatting |

## Code Examples
\`\`\`typescript
const options = {
  chunking_max_tokens: 200,
  chunking_merge_peers: true,
  chunking_use_markdown_tables: true,
};
\`\`\`

## Best Practices
Follow these guidelines for optimal results.
`);

  try {
    console.log("⚙️  Testing different chunking configurations...");

    // Configuration 1: Small chunks with raw text
    const config1 = await client.chunkHybridSync(document, "config.md", {
      chunking_max_tokens: 50,
      chunking_include_raw_text: true,
      chunking_merge_peers: false,
    });

    // Configuration 2: Large chunks with table formatting
    const config2 = await client.chunkHybridSync(document, "config.md", {
      chunking_max_tokens: 300,
      chunking_use_markdown_tables: true,
      chunking_merge_peers: true,
    });

    // Configuration 3: Hierarchical chunker
    const config3 = await client.chunkHierarchicalSync(document, "config.md", {
      chunking_use_markdown_tables: true,
    });

    console.log("\n📊 Configuration Results:");
    console.log(`Config 1 (small chunks): ${config1.chunks.length} chunks`);
    console.log(`Config 2 (large chunks): ${config2.chunks.length} chunks`);
    console.log(`Config 3 (hierarchical): ${config3.chunks.length} chunks`);

    console.log("\n⏱️  Processing Times:");
    console.log(`Config 1: ${config1.processing_time}s`);
    console.log(`Config 2: ${config2.processing_time}s`);
    console.log(`Config 3: ${config3.processing_time}s`);

  } catch (error) {
    console.error("❌ Configuration test error:", error);
  }
}

async function main() {
  console.log("🚀 Docling Chunking Quick Start Examples\n");

  await quickChunkExample();
  await chunkPDFExample();
  await chunkFromURLExample();
  await customChunkingOptions();

  console.log("\n🎉 Quick start examples completed!");
  console.log("\n💡 Next steps:");
  console.log("  - Try different chunking_max_tokens values");
  console.log("  - Experiment with chunking_merge_peers setting");
  console.log("  - Use chunking_include_raw_text for comparison");
  console.log("  - Test with your own documents");
}

if (require.main === module) {
  main().catch(console.error);
}

export {
  quickChunkExample,
  chunkPDFExample,
  chunkFromURLExample,
  customChunkingOptions,
};
