#!/usr/bin/env tsx

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Docling } from "../src";

/**
 * Async conversion with a webhook trigger when processing completes.
 * - Starts an async task
 * - Waits for completion via SDK helper (polling under the hood)
 * - Sends a webhook POST to your endpoint with task id and final status
 */
async function main() {
  const baseUrl =
    process.env.DOCLING_URL || "https://valiant-reprieve-dev.up.railway.app";
  const webhookUrl = process.env.WEBHOOK_URL || "http://localhost:3001/webhook";
  const client = new Docling({ api: { baseUrl, timeout: 120000 } });

  const pdfPath = join(process.cwd(), "examples", "example.pdf");
  const buf = await readFile(pdfPath);

  console.log("🚀 Start async task (webhook demo)");
  const task = await client.convertFileAsync({
    files: buf,
    filename: "example.pdf",
    to_formats: ["md"],
  });
  console.log("task:", task.taskId, task.status);

  const finalStatus = await task.waitForCompletion();
  console.log("task done:", finalStatus.task_status);

  // Send webhook with task info
  const payload = {
    task_id: task.taskId,
    status: finalStatus.task_status,
    completed_at: new Date().toISOString(),
  };

  const r = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    console.error("Webhook failed:", r.status, await r.text());
  } else {
    console.log("Webhook sent successfully to", webhookUrl);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
