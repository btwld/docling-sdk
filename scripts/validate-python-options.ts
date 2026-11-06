/** Additional real-converter option, referenced-image and timeout checks. */
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createCLIClient } from "../src/cli-entry";

const runtime = resolve(process.argv[2] || ".context/release-hardening-2026-11-06/python-runtime");
const scenario = process.argv[3] || "cli-options";
const evidence = join(runtime, "evidence", scenario);
await mkdir(evidence, { recursive: true });
const client = createCLIClient({
  doclingPath: join(runtime, "venv/bin/docling"),
  outputDir: join(
    evidence,
    scenario === "referenced-options" ? "jobs with spaces & ampersand" : "jobs"
  ),
  timeout: 90000,
  verbose: scenario === "timeout-options",
});
const commands: unknown[] = [];
let diagnostics = "";
client.progress.on("stderr", ({ data }) => {
  diagnostics += data;
});
client.progress.on("command-built", (command) => commands.push(command));
try {
  if (scenario === "cli-options") {
    const result = await client.convertWithProgress({
      sources: [join(runtime, "fixtures/original.docx")],
      fromFormats: ["docx", "pptx"],
      toFormats: ["md"],
      ocr: false,
      ocrLang: ["en", "fr"],
      verbose: 2,
    });
    await writeFile(join(evidence, "response.json"), JSON.stringify(result, null, 2));
    assert.equal(result.success, true, result.error?.message);
    assert.match(result.outputs?.markdown || "", /Apples/);
    console.log(
      JSON.stringify({
        scenario,
        success: true,
        checks: [
          "repeatable input formats",
          "explicit no OCR",
          "comma-separated OCR languages",
          "counted verbosity",
          "actual output content",
        ],
      })
    );
  } else if (scenario === "default-options") {
    const result = await client.convertFromFile(join(runtime, "fixtures/original.pdf"), {
      to_formats: ["json"],
      artifacts_path: join(runtime, "models/docling"),
    });
    await writeFile(join(evidence, "response.json"), JSON.stringify(result, null, 2));
    assert.equal(result.status, "success", JSON.stringify(result.errors));
    assert.deepEqual(
      Object.keys(
        (result.document.json_content as unknown as { pages: Record<string, unknown> }).pages
      ).sort(),
      ["1", "2"]
    );
    console.log(
      JSON.stringify({
        scenario,
        status: result.status,
        checks: ["default OCR selection works with standard Docling installation", "two page keys"],
      })
    );
  } else if (scenario === "table-options") {
    const result = await client.convertFromFile(join(runtime, "fixtures/original.docx"), {
      to_formats: ["json"],
      do_ocr: false,
      do_table_structure: true,
    });
    await writeFile(join(evidence, "response.json"), JSON.stringify(result, null, 2));
    assert.equal(result.status, "success", JSON.stringify(result.errors));
    assert.ok(result.document.json_content?.tables?.length);
    console.log(
      JSON.stringify({
        scenario,
        status: result.status,
        checks: ["real --tables option", "structured table retained"],
      })
    );
  } else if (scenario === "timeout-options") {
    const result = await client.convertFromFile(join(runtime, "fixtures/timeout.pdf"), {
      to_formats: ["json"],
      do_ocr: false,
      document_timeout: 1,
      artifacts_path: join(runtime, "models/docling"),
    });
    await writeFile(join(evidence, "response.json"), JSON.stringify(result, null, 2));
    assert.equal(
      result.status,
      "failure",
      "Timeout probe must actually fail to count as timeout evidence"
    );
    assert.equal(result.document.json_content, undefined);
    assert.ok(result.errors?.length);
    console.log(
      JSON.stringify({
        scenario,
        status: result.status,
        checks: ["real engine deadline failure", "no incomplete JSON accepted"],
        limitation:
          "Docling CLI exports only SUCCESS; PARTIAL_SUCCESS cannot be recovered from its file protocol",
      })
    );
  } else if (scenario === "process-timeout-options") {
    const warmup = await client.convertFromFile(join(runtime, "fixtures/original.docx"), {
      to_formats: ["text"],
      do_ocr: false,
    });
    assert.equal(warmup.status, "success");
    const before = await readdir(join(evidence, "jobs"));
    client.updateConfig({ timeout: 1000 });
    const result = await client.convertFromFile(join(runtime, "fixtures/original.pdf"), {
      to_formats: ["json"],
      do_ocr: false,
      artifacts_path: join(runtime, "models/docling"),
    });
    await writeFile(join(evidence, "response.json"), JSON.stringify(result, null, 2));
    assert.equal(result.status, "failure");
    assert.equal(result.document.json_content, undefined);
    assert.ok(
      result.errors?.some(
        (error) =>
          error.details &&
          typeof error.details === "object" &&
          "name" in error.details &&
          error.details.name === "ProcessTimeoutError"
      )
    );
    assert.deepEqual(await readdir(join(evidence, "jobs")), before);
    console.log(
      JSON.stringify({
        scenario,
        status: result.status,
        checks: [
          "real Python child process deadline",
          "typed timeout retained",
          "failed job cleaned",
          "no partial output published",
        ],
      })
    );
  } else if (scenario === "partial-options") {
    const output = join(evidence, "partial-export");
    await mkdir(output, { recursive: true });
    const result = await client.executeCommand([
      join(runtime, "fixtures/timeout.pdf"),
      "--pipeline",
      "legacy",
      "--pdf-backend",
      "pypdfium2",
      "--no-ocr",
      "--document-timeout",
      "0.001",
      "--artifacts-path",
      join(runtime, "models/docling"),
      "--to",
      "json",
      "--output",
      output,
      "--verbose",
    ]);
    await writeFile(join(evidence, "response.json"), JSON.stringify(result, null, 2));
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /exceeded the specified timeout/);
    assert.deepEqual(await readdir(output), []);
    console.log(
      JSON.stringify({
        scenario,
        exitCode: result.exitCode,
        outputs: [],
        checks: [
          "real legacy-pipeline deadline reached",
          "upstream exits zero without exporting partial results",
          "SDK public literal command adapter exercised",
        ],
        limitation:
          "Main typed conversion pipeline remains standard; legacy was an explicit diagnostic command only",
      })
    );
  } else if (scenario === "referenced-options") {
    const filename = process.argv[4] || "original.docx";
    const stem = parse(filename).name;
    const result = await client.convertToFile(
      await readFile(join(runtime, "fixtures/original.docx")),
      filename,
      { to_formats: ["md", "json", "html"], do_ocr: false, image_export_mode: "referenced" }
    );
    assert.equal(result.success, true);
    assert.ok(result.fileStream);
    const chunks: Buffer[] = [];
    for await (const chunk of result.fileStream as AsyncIterable<Buffer>)
      chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    await writeFile(join(evidence, "response.zip"), bytes);
    const files: Record<string, Buffer> = {};
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(end >= 0);
    const count = bytes.readUInt16LE(end + 10);
    let offset = bytes.readUInt32LE(end + 16);
    for (let index = 0; index < count; index++) {
      const nameLength = bytes.readUInt16LE(offset + 28);
      const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
      const local = bytes.readUInt32LE(offset + 42);
      const dataStart =
        local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const data = bytes.subarray(dataStart, dataStart + bytes.readUInt32LE(offset + 20));
      files[name] = bytes.readUInt16LE(offset + 10) === 8 ? inflateRawSync(data) : data;
      offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    }
    await writeFile(join(evidence, "entries.json"), JSON.stringify(Object.keys(files), null, 2));
    const markdown = files[`${stem}.md`]?.toString() || "";
    const reference = markdown.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1];
    assert.ok(reference, "no referenced image in Markdown");
    const decoded = decodeURIComponent(reference);
    assert.ok(files[decoded], "referenced Markdown asset omitted from ZIP: " + reference);
    assert.equal(files[decoded].subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const json = JSON.parse(files[`${stem}.json`]?.toString() || "null");
    assert.ok(files[json.pictures[0].image.uri], "referenced JSON asset omitted from ZIP");
    const htmlReference = files[`${stem}.html`]?.toString().match(/<img[^>]+src="([^"]+)"/)?.[1];
    assert.ok(
      htmlReference && files[decodeURIComponent(htmlReference)],
      "referenced HTML asset omitted from ZIP"
    );
    console.log(
      JSON.stringify({
        scenario,
        success: true,
        entries: Object.keys(files),
        checks: [
          "referenced Markdown and JSON PNG assets included",
          "references resolve within ZIP",
          "PNG signature",
        ],
      })
    );
  } else throw new Error("Unknown option scenario");
} finally {
  await writeFile(join(evidence, "commands.json"), JSON.stringify(commands, null, 2));
  await writeFile(join(evidence, "diagnostics.log"), diagnostics);
  client.destroy();
}
