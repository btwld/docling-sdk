import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createAPIClient } from "../../src/index";

const baseUrl = process.env.DOCLING_TEST_SERVE_URL;
const fixtureDirectory = process.env.DOCLING_TEST_FIXTURES;
describe.skipIf(!baseUrl || !fixtureDirectory)("real pinned Docling Serve", () => {
  const client = createAPIClient(baseUrl ?? "http://127.0.0.1:5000", { retries: 0, timeout: 120000 });
  afterAll(() => client.destroy());

  it("reports health through the SDK", async () => {
    expect((await client.health()).status).toBe("ok");
  });

  it("converts original DOCX through multipart and source APIs", async () => {
    const input = await readFile(join(fixtureDirectory!, "original.docx"));
    const result = await client.convert(input, "original.docx", { to_formats: ["md", "json"], do_ocr: false });
    expect(result.status).toBe("success");
    expect(result.document.md_content).toContain("Apples");
    expect(result.document.json_content).toMatchObject({ schema_name: "DoclingDocument" });
    const source = await client.convertSource({ sources: [{ kind: "file", filename: "original.docx", base64_string: input.toString("base64") }], options: { to_formats: ["md"], do_ocr: false } });
    expect(source.status).toBe("success");
    expect(source.document.md_content).toContain("Pears");
  }, 120000);

  it("settles an actual async conversion and downloads a ZIP", async () => {
    const input = await readFile(join(fixtureDirectory!, "original.docx"));
    const task = await client.convertSourceAsync({ sources: [{ kind: "file", filename: "original.docx", base64_string: input.toString("base64") }], options: { to_formats: ["md"], do_ocr: false } });
    const result = await task.waitForCompletion();
    expect(result.task_status).toBe("success");
    expect((await task.getResult()).document.md_content).toContain("Apples");
    const zip = await client.convertToFile(input, "original.docx", { to_formats: ["md"], do_ocr: false });
    expect(zip.success).toBe(true);
    expect(zip.fileStream).toBeDefined();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.fileStream!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe("PK");
  }, 120000);
});
