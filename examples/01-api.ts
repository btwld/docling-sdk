#!/usr/bin/env tsx

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { Docling } from "../src";

async function main() {
  const baseUrl =
    process.env.DOCLING_URL || "https://valiant-reprieve-dev.up.railway.app";
  const client = new Docling({ api: { baseUrl, timeout: 60000 } });

  console.log("🏥 Health check");
  const health = await client.health();
  console.log("health:", health);

  const pdfPath = join(process.cwd(), "examples", "example.pdf");
  const buf = await readFile(pdfPath);

  console.log("\n🧪 Sync JSON (inbody)");
  const syncJson = await client.convertFile({
    files: buf,
    filename: "example.pdf",
    from_formats: ["pdf"],
    to_formats: ["json"],
  });
  console.log("json keys:", Object.keys(syncJson.document || {}));

  console.log("\n🧪 Sync Markdown (inbody)");
  const syncMd = await client.convertFile({
    files: buf,
    from_formats: ["pdf"],
    to_formats: ["md"],
  });
  console.log("md length:", syncMd.document?.md_content?.length || 0);

  console.log("\n🧪 Async ZIP (task → zip)");
  const task = await client.convertFileAsync({
    files: buf,
    filename: "example.pdf",
    from_formats: ["pdf"],
    to_formats: ["md", "json"],
  });
  console.log("task:", task.taskId, task.status);
  const done = await task.waitForCompletion();
  console.log("task done:", done.task_status);

  console.log("\n🧪 Async JSON (inbody)");
  const jsonTask = await client.convertSourceAsync({
    sources: [
      {
        kind: "http",
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      },
    ],
    options: { to_formats: ["md"] },
    target: { kind: "inbody" },
  });
  console.log("jsonTask:", jsonTask.taskId, jsonTask.status);

  await jsonTask.waitForCompletion();

  const jsonResult = await client.getTaskResult(jsonTask.taskId);

  console.log("async json keys:", Object.keys(jsonResult.document || {}));

  console.log("\n🧪 ZIP download (convertToFile)");
  const zipRes = await client.convertToFile(buf, "example.pdf", {
    to_formats: ["md", "json"],
  });
  if (zipRes.success && zipRes.fileStream) {
    const out = createWriteStream(
      join(process.cwd(), "examples", "output", "converted-files.zip")
    );
    zipRes.fileStream.pipe(out);
    await new Promise<void>((resolve) => out.on("close", () => resolve()));
    console.log("saved converted-files.zip");
  } else {
    console.log("zip conversion failed:", zipRes.error?.message);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
