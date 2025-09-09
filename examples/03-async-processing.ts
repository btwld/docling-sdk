/**
 * Example: Async Document Processing
 *
 * Demonstrates asynchronous document processing with task management,
 * progress polling, and webhook integration.
 */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Docling } from "../src";

async function basicAsyncProcessing() {
  console.log("Basic Async Processing Example");

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
    const testDocument = Buffer.from(`# Async Processing Test Document

This document will be processed asynchronously to demonstrate 
the async task management capabilities of the Docling SDK.

## Features Being Tested
- Async task submission
- Task status polling
- Result retrieval
- Progress tracking

## Content Sections

### Section 1: Introduction
This is the introduction section with some sample content.

### Section 2: Data Analysis
| Metric | Value | Status |
|--------|-------|--------|
| Performance | 95% | Good |
| Efficiency | 87% | Fair |
| Quality | 99% | Excellent |

### Section 3: Conclusion
The async processing capabilities provide efficient handling of large documents.
    `);

    console.log("Submitting document for async processing...");

    const task = await client.convertFileAsync({
      files: testDocument,
      filename: "async-test.md",
      to_formats: ["md", "json", "html"],
      do_table_structure: true,
      do_picture_description: true,
    });

    console.log(`Task submitted! Task ID: ${task.taskId}`);
    console.log(`Task status: ${task.status}`);

    console.log("Waiting for task completion...");

    const startTime = Date.now();

    const finalStatus = await task.waitForCompletion();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Task completed [${elapsed}s]: ${finalStatus.task_status}`);

    if (finalStatus.task_status !== "success") {
      console.error(`Task failed with status: ${finalStatus.task_status}`);
      return;
    }

    console.log("Task completed successfully!");

    const resultFile = await client.getTaskResultFile(task.taskId);

    if (resultFile.success && resultFile.fileStream) {
      const outputPath = "./output/async-result.zip";
      const writeStream = createWriteStream(outputPath);

      resultFile.fileStream.pipe(writeStream);

      await new Promise<void>((resolve, reject) => {
        writeStream.on("finish", () => {
          console.log(`Results saved to: ${outputPath}`);
          resolve();
        });
        writeStream.on("error", reject);
      });
    } else {
      console.error("Failed to get result file:", resultFile.error?.message);
    }
  } catch (error) {
    console.error(
      "Async processing error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function asyncWithProgressTracking() {
  console.log("\\nAsync Processing with Real-time Progress");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
    progress: {
      method: "websocket",
      onProgress: (progress) => {
        const percentage = progress.percentage ?? 0;
        const stage = progress.stage || "processing";
        const taskId = progress.taskId ? ` [${progress.taskId.slice(-8)}]` : "";

        const progressBar =
          "█".repeat(Math.floor(percentage / 5)) +
          "░".repeat(20 - Math.floor(percentage / 5));
        process.stdout.write(
          `\\rProcessing ${stage}${taskId}: [${progressBar}] ${percentage.toFixed(
            1
          )}%`
        );
      },
      onComplete: (result) => {
        console.log("\\nAsync processing completed with progress tracking!");
      },
      onError: (error) => {
        console.error("\\nProgress error:", error.message);
      },
    },
  });

  try {
    const testDocument = Buffer.from(
      "# Progress Test\\n\\nAsync processing with progress tracking."
    );

    console.log("Starting async processing with progress tracking...");

    const result = await client.convertFileAsync({
      files: testDocument,
      filename: "progress-test.md",
      to_formats: ["md", "json"],
      do_table_structure: true,
    });

    await result.waitForCompletion();

    console.log(`\\nTask completed! Final status: ${result.status}`);
  } catch (error) {
    console.error(
      "\\nProgress tracking error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function webhookExample() {
  console.log("\\nWebhook Integration Example");

  const webhookUrl = process.env.WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("No WEBHOOK_URL provided, skipping webhook example");
    console.log("   Set WEBHOOK_URL environment variable to test webhooks");
    return;
  }

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
    progress: {
      onWebhook: async (webhookData) => {
        console.log("Webhook received:", {
          taskId: webhookData.task_id,
          status: webhookData.status,
          timestamp: new Date().toISOString(),
        });
      },
    },
  });

  try {
    const testDocument = Buffer.from(
      "# Webhook Test\\n\\nTesting webhook notifications."
    );

    console.log(`Submitting task with webhook: ${webhookUrl}`);

    const task = await client.convertFileAsync({
      files: testDocument,
      filename: "webhook-test.md",
      to_formats: ["md"],
    });

    console.log(`Task submitted with webhook! Task ID: ${task.taskId}`);
    console.log("Processing... webhook notifications will be received");

    await task.waitForCompletion();

    console.log("Webhook example completed!");

    console.log(
      "In production, webhook notifications would be sent to your endpoint"
    );
    console.log(`   Webhook URL: ${webhookUrl}`);
    console.log(`   Task ID: ${task.taskId}`);
    console.log(`   Expected payload: { task_id, status, message, timestamp }`);
  } catch (error) {
    console.error(
      "Webhook error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function batchAsyncProcessing() {
  console.log("\\nBatch Async Processing");

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 60000,
    },
  });

  try {
    const documents = Array.from({ length: 3 }, (_, i) => ({
      filename: `batch-doc-${i + 1}.md`,
      content: Buffer.from(
        `# Batch Document ${i + 1}\\n\\n` +
          `This is document ${i + 1} in the batch processing example.\\n\\n` +
          `## Content\\n` +
          `- Item A for document ${i + 1}\\n` +
          `- Item B for document ${i + 1}\\n` +
          `- Item C for document ${i + 1}\\n\\n` +
          `| Column 1 | Column 2 |\\n` +
          `|----------|----------|\\n` +
          `| Data ${i + 1}A | Data ${i + 1}B |`
      ),
    }));

    console.log(
      `Submitting ${documents.length} documents for batch processing...`
    );

    const tasks = await Promise.all(
      documents.map((doc, index) =>
        client
          .convertFileAsync({
            files: doc.content,
            filename: doc.filename,
            to_formats: ["json"],
            do_table_structure: true,
          })
          .then((task) => ({ index, task, filename: doc.filename }))
      )
    );

    console.log("All tasks submitted!");
    tasks.forEach(({ index, task, filename }) => {
      console.log(`  Document ${filename}: ${task.taskId}`);
    });

    console.log("\\nWaiting for all tasks to complete...");

    const results = await Promise.all(
      tasks.map(async ({ index, task, filename }) => {
        try {
          await task.waitForCompletion();
          const result = await client.getTaskResult(task.taskId);

          return {
            index,
            filename,
            success: true,
            taskId: task.taskId,
            result: "success",
          };
        } catch (error) {
          return {
            index,
            filename,
            success: false,
            taskId: task.taskId,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      })
    );

    console.log("\\nBatch Processing Results:");
    results.forEach(({ filename, success, taskId, result, error }) => {
      if (success) {
        console.log(`  ✅ ${filename} (${taskId.slice(-8)})`);
      } else {
        console.log(`  ❌ ${filename} (${taskId.slice(-8)}): ${error}`);
      }
    });

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `\\nBatch completed: ${successCount}/${results.length} successful`
    );
  } catch (error) {
    console.error(
      "Batch processing error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function main() {
  console.log("Docling SDK - Async Processing Examples");
  console.log("=======================================");

  if (!process.env.DOCLING_URL) {
    console.log("Using default URL: http://localhost:5001");
  }

  if (!process.env.DOCLING_API_KEY) {
    console.log("No API key provided (may be optional)");
  } else {
    console.log("API key configured");
  }

  if (!process.env.WEBHOOK_URL) {
    console.log("No webhook URL provided (webhook example will be skipped)");
  } else {
    console.log("Webhook URL configured");
  }

  await basicAsyncProcessing();
  await asyncWithProgressTracking();
  await webhookExample();
  await batchAsyncProcessing();

  console.log("\\nAll async processing examples completed!");
}

if (require.main === module) {
  main().catch(console.error);
}

export {
  basicAsyncProcessing,
  asyncWithProgressTracking,
  webhookExample,
  batchAsyncProcessing,
  main,
};
