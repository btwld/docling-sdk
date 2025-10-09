/**
 * Example: Document Chunking
 *
 * Demonstrates the new chunking capabilities for breaking documents
 * into smaller, semantically meaningful chunks for RAG applications.
 */

import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Docling } from "../src";

async function basicChunkingExample() {
  console.log("🔗 Basic Chunking Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
  });

  try {
    await mkdir("./output", { recursive: true });

    // Create a test document
    const testDocument = Buffer.from(`# Document Chunking Test

## Introduction
This is a test document to demonstrate the chunking capabilities of Docling.
The document contains multiple sections that should be chunked appropriately.

## Section 1: Overview
Document chunking is the process of breaking down large documents into smaller,
semantically meaningful pieces. This is particularly useful for:

- RAG (Retrieval Augmented Generation) applications
- Search indexing
- Content analysis
- Information extraction

## Section 2: Technical Details
The chunking process considers document structure, including:

### Headings and Subheadings
The chunker respects the hierarchical structure of documents.

### Tables and Lists
- Item 1: First item
- Item 2: Second item
- Item 3: Third item

### Code Blocks
\`\`\`python
def chunk_document(text):
    return chunker.chunk(text)
\`\`\`

## Conclusion
This concludes our test document for chunking demonstration.
`);

    console.log("📄 Testing HybridChunker (Sync)...");
    
    // Test HybridChunker synchronous
    const hybridResult = await client.chunkHybridSync(
      testDocument,
      "test-document.md",
      {
        chunking_use_markdown_tables: true,
        chunking_include_raw_text: true,
        chunking_max_tokens: 200,
        chunking_tokenizer: "sentence-transformers/all-MiniLM-L6-v2",
        chunking_merge_peers: true,
      }
    );

    console.log(`✅ HybridChunker created ${hybridResult.chunks.length} chunks`);
    console.log(`⏱️  Processing time: ${hybridResult.processing_time}s`);

    // Save hybrid chunks
    await writeFile(
      "./output/hybrid-chunks.json",
      JSON.stringify(hybridResult, null, 2)
    );

    // Display first few chunks
    console.log("\n📋 First 3 chunks from HybridChunker:");
    hybridResult.chunks.slice(0, 3).forEach((chunk, index) => {
      console.log(`\nChunk ${index + 1}:`);
      console.log(`  Index: ${chunk.chunk_index}`);
      console.log(`  Tokens: ${chunk.num_tokens || "N/A"}`);
      console.log(`  Headings: ${chunk.headings?.join(" > ") || "None"}`);
      console.log(`  Text: ${chunk.text.slice(0, 100)}...`);
      if (chunk.raw_text) {
        console.log(`  Raw Text: ${chunk.raw_text.slice(0, 100)}...`);
      }
    });

    console.log("\n📄 Testing HierarchicalChunker (Sync)...");
    
    // Test HierarchicalChunker synchronous
    const hierarchicalResult = await client.chunkHierarchicalSync(
      testDocument,
      "test-document.md",
      {
        chunking_use_markdown_tables: false,
        chunking_include_raw_text: false,
      }
    );

    console.log(`✅ HierarchicalChunker created ${hierarchicalResult.chunks.length} chunks`);
    console.log(`⏱️  Processing time: ${hierarchicalResult.processing_time}s`);

    // Save hierarchical chunks
    await writeFile(
      "./output/hierarchical-chunks.json",
      JSON.stringify(hierarchicalResult, null, 2)
    );

    // Display first few chunks
    console.log("\n📋 First 3 chunks from HierarchicalChunker:");
    hierarchicalResult.chunks.slice(0, 3).forEach((chunk, index) => {
      console.log(`\nChunk ${index + 1}:`);
      console.log(`  Index: ${chunk.chunk_index}`);
      console.log(`  Headings: ${chunk.headings?.join(" > ") || "None"}`);
      console.log(`  Text: ${chunk.text.slice(0, 100)}...`);
    });

  } catch (error) {
    console.error("❌ Chunking failed:", error);
  }
}

async function asyncChunkingExample() {
  console.log("\n🔄 Async Chunking Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
  });

  try {
    // Read a real PDF file if available
    let documentBuffer: Buffer;
    let filename: string;

    try {
      documentBuffer = await readFile("./examples/example.pdf");
      filename = "example.pdf";
      console.log("📄 Using example.pdf");
    } catch {
      // Fallback to test content
      documentBuffer = Buffer.from(`# Large Document for Async Chunking

This is a larger document that demonstrates async chunking capabilities.
${Array(50).fill("This is repeated content to make the document larger. ").join("")}

## Section A
${Array(30).fill("Content for section A. ").join("")}

## Section B  
${Array(30).fill("Content for section B. ").join("")}

## Section C
${Array(30).fill("Content for section C. ").join("")}
`);
      filename = "large-test-document.md";
      console.log("📄 Using generated test content");
    }

    console.log("🔄 Starting async HybridChunker task...");

    // Create async task for HybridChunker
    const hybridTask = await client.chunkHybridFileAsync({
      files: documentBuffer,
      filename,
      chunking_use_markdown_tables: true,
      chunking_include_raw_text: true,
      chunking_max_tokens: 150,
      include_converted_doc: true,
    });

    console.log(`📋 Task created: ${hybridTask.taskId}`);

    // Set up progress tracking
    hybridTask.on("progress", (status) => {
      console.log(`📊 Progress: ${status.task_status} (position: ${status.task_position || "N/A"})`);
    });

    hybridTask.on("complete", (result) => {
      console.log(`✅ Task completed! Generated ${result.chunks.length} chunks`);
    });

    hybridTask.on("error", (error) => {
      console.error("❌ Task failed:", error.message);
    });

    // Wait for completion
    console.log("⏳ Waiting for task completion...");
    const finalStatus = await hybridTask.waitForCompletion();
    console.log(`🎉 Final status: ${finalStatus.task_status}`);

    // Get the result
    const result = await hybridTask.getResult();
    console.log(`📊 Generated ${result.chunks.length} chunks`);
    console.log(`⏱️  Processing time: ${result.processing_time}s`);

    // Save async result
    await writeFile(
      "./output/async-hybrid-chunks.json",
      JSON.stringify(result, null, 2)
    );

    // Show chunk statistics
    const tokenCounts = result.chunks
      .map(c => c.num_tokens)
      .filter(t => t !== null && t !== undefined) as number[];
    
    if (tokenCounts.length > 0) {
      const avgTokens = tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length;
      const maxTokens = Math.max(...tokenCounts);
      const minTokens = Math.min(...tokenCounts);
      
      console.log(`\n📈 Chunk Statistics:`);
      console.log(`  Average tokens: ${avgTokens.toFixed(1)}`);
      console.log(`  Max tokens: ${maxTokens}`);
      console.log(`  Min tokens: ${minTokens}`);
    }

  } catch (error) {
    console.error("❌ Async chunking failed:", error);
  }
}

async function sourceChunkingExample() {
  console.log("\n🌐 Source Chunking Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
  });

  try {
    // Example with HTTP source
    const httpRequest = {
      sources: [
        {
          kind: "http" as const,
          url: "https://raw.githubusercontent.com/DS4SD/docling/main/README.md",
        },
      ],
      chunking_options: {
        use_markdown_tables: true,
        include_raw_text: false,
        max_tokens: 300,
      },
      include_converted_doc: false,
    };

    console.log("🌐 Chunking from HTTP source...");
    const httpResult = await client.chunkHybridSource(httpRequest);
    
    console.log(`✅ HTTP source chunking completed`);
    console.log(`📊 Generated ${httpResult.chunks.length} chunks`);
    console.log(`⏱️  Processing time: ${httpResult.processing_time}s`);

    // Save HTTP source result
    await writeFile(
      "./output/http-source-chunks.json",
      JSON.stringify(httpResult, null, 2)
    );

    // Show some chunks
    console.log("\n📋 Sample chunks from HTTP source:");
    httpResult.chunks.slice(0, 2).forEach((chunk, index) => {
      console.log(`\nChunk ${index + 1}:`);
      console.log(`  Headings: ${chunk.headings?.join(" > ") || "None"}`);
      console.log(`  Text: ${chunk.text.slice(0, 150)}...`);
    });

  } catch (error) {
    console.error("❌ Source chunking failed:", error);
  }
}

async function comparisonExample() {
  console.log("\n⚖️  Chunker Comparison Example");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
  });

  try {
    const testDoc = Buffer.from(`# Comparison Test Document

## Introduction
This document will be processed by both chunkers for comparison.

## Technical Section
Here we have some technical content with code:

\`\`\`javascript
function processDocument(doc) {
  return chunker.process(doc);
}
\`\`\`

### Subsection A
Content for subsection A with detailed explanations.

### Subsection B  
Content for subsection B with more details.

## Data Section
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value 1  | Value 2  | Value 3  |
| Value 4  | Value 5  | Value 6  |

## Conclusion
Final thoughts and summary.
`);

    console.log("🔄 Running both chunkers for comparison...");

    // Run both chunkers with similar settings
    const [hybridResult, hierarchicalResult] = await Promise.all([
      client.chunkHybridSync(testDoc, "comparison.md", {
        chunking_use_markdown_tables: true,
        chunking_include_raw_text: false,
      }),
      client.chunkHierarchicalSync(testDoc, "comparison.md", {
        chunking_use_markdown_tables: true,
        chunking_include_raw_text: false,
      }),
    ]);

    console.log("\n📊 Comparison Results:");
    console.log(`HybridChunker: ${hybridResult.chunks.length} chunks`);
    console.log(`HierarchicalChunker: ${hierarchicalResult.chunks.length} chunks`);

    console.log("\n⏱️  Processing Times:");
    console.log(`HybridChunker: ${hybridResult.processing_time}s`);
    console.log(`HierarchicalChunker: ${hierarchicalResult.processing_time}s`);

    // Save comparison results
    await writeFile(
      "./output/chunker-comparison.json",
      JSON.stringify({
        hybrid: hybridResult,
        hierarchical: hierarchicalResult,
        comparison: {
          hybrid_chunks: hybridResult.chunks.length,
          hierarchical_chunks: hierarchicalResult.chunks.length,
          hybrid_time: hybridResult.processing_time,
          hierarchical_time: hierarchicalResult.processing_time,
        },
      }, null, 2)
    );

    console.log("💾 Comparison results saved to ./output/chunker-comparison.json");

  } catch (error) {
    console.error("❌ Comparison failed:", error);
  }
}

async function main() {
  console.log("🚀 Starting Docling Chunking Examples\n");

  await basicChunkingExample();
  await asyncChunkingExample();
  await sourceChunkingExample();
  await comparisonExample();

  console.log("\n🎉 All chunking examples completed!");
  console.log("📁 Check the ./output directory for generated files");
}

if (require.main === module) {
  main().catch(console.error);
}

export {
  basicChunkingExample,
  asyncChunkingExample,
  sourceChunkingExample,
  comparisonExample,
};
