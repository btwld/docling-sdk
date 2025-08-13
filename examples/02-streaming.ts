#!/usr/bin/env tsx

import { join } from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { Docling } from "../src";

async function main() {
  const baseUrl =
    process.env.DOCLING_URL || "https://valiant-reprieve-dev.up.railway.app";
  const client = new Docling({ api: { baseUrl, timeout: 60000 } });

  // Content streaming (markdown in body)
  console.log("🌊 API content streaming (md)");
  const mdOut = createWriteStream(
    join(process.cwd(), "examples", "output", "streamed-result.md")
  );
  const mdStream = await client.convertToStream(
    Buffer.from("# Streaming Test\nHello"),
    "test.md",
    mdOut,
    { to_formats: ["md"] }
  );
  if (!mdStream.success)
    console.log("md stream failed:", mdStream.error?.message);

  // ZIP streaming (async submit → result download, no buffering)
  console.log("🌊 API ZIP streaming");
  const zipOut = createWriteStream(
    join(process.cwd(), "examples", "output", "streamed-files.zip")
  );
  const pdfPath = join(process.cwd(), "examples", "example.pdf");
  const zipStream = await client.convertStreamToFile(
    createReadStream(pdfPath),
    "example.pdf",
    { to_formats: ["md", "json"] }
  );
  if (zipStream.success && zipStream.fileStream) {
    zipStream.fileStream.pipe(zipOut);
    await new Promise<void>((resolve) => zipOut.on("close", () => resolve()));
    console.log("saved streamed-files.zip");
  } else {
    console.log("zip stream failed:", zipStream.error?.message);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
