import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Docling } from "../src";

async function main() {
  const baseUrl = process.env.DOCLING_URL || "http://localhost:5001";
  const client = new Docling({ api: { baseUrl, timeout: 60000 } });

  const buf = Buffer.from("# example\n\ncontent");

  const zip = await client.convertToFile(buf, "example.md", {
    to_formats: ["md"],
  });
  if (zip.success && zip.fileStream) {
    const out = createWriteStream(join(process.cwd(), "output.zip"));
    zip.fileStream.pipe(out);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
