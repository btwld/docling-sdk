#!/usr/bin/env tsx

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Docling } from "../src";
import { createWriteStream } from "node:fs";

/**
 * Minimal async conversion with polling progress.
 * - Starts an async task
 * - Polls server /v1/status/{task_id} for progress every 2s
 * - Fetches the final result when complete
 */
async function main() {
  const baseUrl =
    process.env.DOCLING_URL || "https://valiant-reprieve-dev.up.railway.app";
  const client = new Docling({ api: { baseUrl, timeout: 120000 } });

  const pdfPath = join(process.cwd(), "examples", "example.pdf");
  const buf = await readFile(pdfPath);

  console.log("🚀 Start async task");
  const task = await client.convertFileAsync({
    files: buf,
    filename: "example.pdf",
    to_formats: ["md", "json"],
  });
  console.log("task:", task.taskId, task.status);

  const started = Date.now();
  const terminal = new Set(["success", "failure"]);

  // Programmatic progress polling using SDK
  while (true) {
    const s = await task.poll();
    console.log("progress:", s.task_status, s.task_position ?? "-");
    if (terminal.has(s.task_status)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Download ZIP result
  const zip = await client.getTaskResultFile(task.taskId);
  const outPath = join(process.cwd(), "examples", "output", "async-result.zip");
  const out = createWriteStream(outPath);

  if (zip.success && zip.fileStream) {
    zip.fileStream.pipe(out);
    await new Promise<void>((resolve) => out.on("close", () => resolve()));
    console.log("✅ saved:", outPath);
  } else {
    console.log("❌ failed to download ZIP:", zip.error?.message);
  }

  console.log("⏱ elapsed:", Math.round((Date.now() - started) / 1000), "s");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
