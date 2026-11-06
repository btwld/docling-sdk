/** Real Python CLI validation. Run through validate-python-runtime.py to isolate caches/env. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createCLIClient } from "../src/cli-entry";
import type { ConversionOptions } from "../src/types/api";

const runtime = resolve(process.argv[2] || ".context/release-hardening-2026-11-06/python-runtime");
const scenario = process.argv[3] || "docx";
const extension = scenario === "pptx" ? "pptx" : scenario === "docx" ? "docx" : "pdf";
const filename = `${scenario === "scanned" ? "scanned" : scenario === "corrupt" ? "corrupt" : "original"}.${extension}`;
const evidence = join(runtime, "evidence", scenario);
await mkdir(evidence, { recursive: true });
const client = createCLIClient({
  doclingPath: join(runtime, "venv/bin/docling"),
  outputDir: join(evidence, "jobs"),
  timeout: 90000,
});
const commands: unknown[] = [];
client.progress.on("command-built", (command) => commands.push(command));
const options: ConversionOptions = {
  to_formats: scenario === "corrupt" ? ["json"] : ["md", "json"],
  do_ocr: scenario === "scanned",
  ocr_engine: "rapidocr",
  image_export_mode: "embedded",
  ...(scenario === "scanned" || scenario === "pdf"
    ? { artifacts_path: join(runtime, "models/docling") }
    : {}),
};
try {
  const started = Date.now();
  const result = await client.convertFromFile(join(runtime, "fixtures", filename), options);
  await writeFile(join(evidence, "response.json"), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(evidence, "commands.json"), `${JSON.stringify(commands, null, 2)}\n`);
  if (scenario === "corrupt") {
    assert.equal(result.status, "failure");
    assert.equal(result.document.json_content, undefined);
    assert.ok(result.errors?.length);
    console.log(
      JSON.stringify({
        scenario,
        status: result.status,
        checks: ["corrupt PDF reported failure", "no JSON content", "errors retained"],
      })
    );
  } else {
    assert.equal(result.status, "success", JSON.stringify(result.errors));
    const json = result.document.json_content as unknown as Record<string, unknown>;
    assert.equal(json.schema_name, "DoclingDocument");
    assert.equal(typeof json.version, "string");
    assert.equal(json.name, basename(filename, `.${extension}`));
    assert.ok(Array.isArray(json.texts));
    assert.ok(Array.isArray(json.tables));
    assert.ok(Array.isArray(json.pictures));
    const markdown = result.document.md_content || "";
    const text = (json.texts as Array<{ text?: string }>).map((item) => item.text || "").join("\n");
    const checks = [
      "actual filenames accepted",
      "DoclingDocument schema name/version",
      "structured text/table/picture arrays",
    ];
    if (scenario !== "scanned") {
      for (const marker of [
        `${extension.toUpperCase()}_ALPHA`,
        `${extension.toUpperCase()}_OMEGA`,
        "Apples",
        "11",
        "Pears",
        "22",
      ])
        assert.ok(text.includes(marker) || markdown.includes(marker), `missing ${marker}`);
      assert.ok(json.tables.length > 0, "table structure missing");
      assert.ok(json.pictures.length > 0, "picture item missing");
      checks.push("first/last content markers", "table cells", "picture items");
    } else {
      assert.match(markdown, /SCANNED\s*ALPHA/i);
      checks.push("scan text recognized by real OCR");
    }
    const pages = json.pages && typeof json.pages === "object" ? Object.keys(json.pages) : [];
    if (extension === "pdf") {
      assert.deepEqual(pages.sort(), scenario === "scanned" ? ["1"] : ["1", "2"]);
      const textPages = new Set(
        (json.texts as Array<{ prov?: Array<{ page_no?: number }> }>).flatMap(
          (item) => item.prov?.map((prov) => prov.page_no) || []
        )
      );
      for (const page of pages)
        assert.ok(textPages.has(Number(page)), `no text provenance for page ${page}`);
      checks.push("expected page keys and text provenance per page");
    }
    const notesPresent = text.includes("PPTX_NOTES");
    const summary = {
      scenario,
      status: result.status,
      elapsedMs: Date.now() - started,
      schema: json.schema_name,
      schemaVersion: json.version,
      pages,
      tables: json.tables.length,
      pictures: json.pictures.length,
      notesPresent,
      markdownSha256: createHash("sha256").update(markdown).digest("hex"),
      checks,
    };
    await writeFile(join(evidence, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary));
  }
} finally {
  client.destroy();
}
