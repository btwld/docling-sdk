#!/usr/bin/env tsx

import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { readFileSync } from "node:fs";
import { Docling } from "../src";

async function main() {
  const cli = new Docling({ cli: {} });

  const pdfPath = join(process.cwd(), "examples", "example.pdf");
  const pdfBuffer = readFileSync(pdfPath);

  // Convert from buffer to Markdown
  console.log("🧪 CLI convertFromBuffer → md");
  const r1 = await cli.convertFromBuffer(pdfBuffer, "example.pdf", {
    to_formats: ["md"],
  });
  console.log(
    "md length:",
    r1.data &&
      "document" in r1.data &&
      r1.data.document &&
      typeof r1.data.document === "object" &&
      "md_content" in r1.data.document
      ? (r1.data.document.md_content as string)?.length || 0
      : 0
  );

  // Convert from file path to HTML
  console.log("🧪 CLI convertFromFile → html");
  const r2 = await cli.convertFromFile(pdfPath, { to_formats: ["html"] });
  console.log(
    "html length:",
    r2.data &&
      "document" in r2.data &&
      r2.data.document &&
      typeof r2.data.document === "object" &&
      "html_content" in r2.data.document
      ? (r2.data.document.html_content as string)?.length || 0
      : 0
  );

  // True streaming to file (Markdown)
  console.log("🌊 CLI convertToStream → md");
  const mdOut = createWriteStream(
    join(process.cwd(), "examples", "output", "cli-stream.md")
  );
  const s1 = await cli.convertToStream(
    { sources: [pdfPath], toFormats: ["md"] },
    mdOut,
    false
  );
  if (!s1.success) console.log("md stream failed:", s1.error?.message);

  // True streaming to file (ZIP)
  console.log("🌊 CLI convertToStream → zip");
  const zipOut = createWriteStream(
    join(process.cwd(), "examples", "output", "cli-stream.zip")
  );
  const s2 = await cli.convertToStream(
    { sources: [pdfPath], toFormats: ["md"] },
    zipOut,
    true
  );
  if (!s2.success) console.log("zip stream failed:", s2.error?.message);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
