import { chmod, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { createCLIClient } from "../../src/cli-entry";

const directories: string[] = [];
const clients: ReturnType<typeof createCLIClient>[] = [];
afterEach(async () => {
  clients.splice(0).forEach((client) => client.destroy());
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});
async function fixture(config: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cli-assets-"));
  directories.push(directory);
  const executable = join(directory, "converter.mjs");
  await copyFile(resolve("tests/fixtures/cli-stub.mjs"), executable);
  await chmod(executable, 0o700);
  await writeFile(
    `${executable}.json`,
    JSON.stringify({ assets: true, ...config, log: join(directory, "calls.jsonl") })
  );
  const outputDir = join(directory, "outputs with spaces & ampersand");
  const client = createCLIClient({ doclingPath: executable, outputDir, timeout: 3000 });
  clients.push(client);
  const input = join(directory, "original.pdf");
  await writeFile(input, "original payload");
  return { directory, client, outputDir, input };
}
function unzip(bytes: Buffer): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString();
    const local = bytes.readUInt32LE(offset + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + bytes.readUInt32LE(offset + 20));
    files[name] = bytes.readUInt16LE(offset + 10) === 8 ? inflateRawSync(data) : data;
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return files;
}
async function collect(stream: NodeJS.ReadableStream | undefined) {
  expect(stream).toBeDefined();
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

it("includes validated referenced images in ZIP with portable per-format references", async () => {
  const f = await fixture({ quoteAssets: true });
  const result = await f.client.convertToFile(Buffer.from("original payload"), "original.pdf", {
    to_formats: ["md", "json", "html"],
    image_export_mode: "referenced",
  });
  expect(result.success).toBe(true);
  const files = unzip(await collect(result.fileStream));
  const markdown = files["original.md"]?.toString() || "";
  const reference = markdown.match(/!\[Image\]\(([^)]+)\)/)?.[1];
  expect(reference).toBe("original.md.assets/original_artifacts/image.png");
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  expect(files[reference || ""]).toEqual(bytes);
  const document = JSON.parse(files["original.json"]?.toString() || "null");
  expect(document.pictures[0].image.uri).toBe("original.json.assets/original_artifacts/image.png");
  expect(files[document.pictures[0].image.uri]).toEqual(bytes);
  expect(files["original.html"]?.toString()).toContain(
    'src="original.html.assets/original_artifacts/image.png"'
  );
  expect(files["original.html.assets/original_artifacts/image.png"]).toEqual(bytes);
  expect(Object.keys(files)).toHaveLength(6);
  expect(markdown).not.toContain(f.outputDir);
  expect(await readdir(f.outputDir)).toEqual([]);
});

it("retains referenced files in the public output inventory", async () => {
  const f = await fixture();
  const result = await f.client.convertWithProgress({
    sources: [f.input],
    toFormats: ["md"],
    imageExportMode: "referenced",
  });
  expect(result.success).toBe(true);
  expect(result.outputFiles).toHaveLength(2);
  const asset = result.outputFiles?.find((path) => path.endsWith("image.png"));
  expect(asset).toBeDefined();
  expect(result.outputs?.markdown).toContain(asset);
  expect(await readFile(asset || "")).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
});

it.skipIf(process.platform === "win32")(
  "refuses referenced symlink assets and preserves the external target",
  async () => {
    const f = await fixture();
    const secret = join(f.directory, "caller-owned.png");
    await writeFile(secret, "caller-owned bytes");
    const executable = join(f.directory, "converter.mjs");
    await writeFile(
      `${executable}.json`,
      JSON.stringify({
        assets: true,
        assetSymlink: true,
        escapeTarget: secret,
        log: join(f.directory, "calls.jsonl"),
      })
    );
    const result = await f.client.convertToFile(Buffer.from("payload"), "original.pdf", {
      to_formats: ["md"],
      image_export_mode: "referenced",
    });
    expect(result.success).toBe(false);
    expect(result.fileStream).toBeUndefined();
    expect(result.error?.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("refusing symlink") }),
      ])
    );
    expect(await readFile(secret, "utf8")).toBe("caller-owned bytes");
    expect(await readdir(f.outputDir)).toEqual([]);
  }
);

it.each(["file", "stream"])(
  "relocates decoded JSON URI values literally through the %s ZIP entry point",
  async (entryPoint) => {
    const f = await fixture({ ensureAscii: true, assetMetadata: true });
    const outputDir = join(f.directory, "exports é and spaces");
    f.client.updateConfig({ outputDir });
    for (const filename of ["cost $&.pdf", "cost $$.pdf", "résumé.pdf", "emoji 🚀.pdf"]) {
      const stem = filename.slice(0, -4);
      const source = "unchanged content $& $$ and résumé";
      let archive: Buffer;
      if (entryPoint === "file") {
        const result = await f.client.convertToFile(Buffer.from(source), filename, {
          to_formats: ["json", "md", "html"],
          image_export_mode: "referenced",
        });
        expect(result.success).toBe(true);
        archive = await collect(result.fileStream);
      } else {
        const input = join(f.directory, filename);
        await writeFile(input, source);
        const chunks: Buffer[] = [];
        const output = new Writable({
          write(chunk, _encoding, done) {
            chunks.push(Buffer.from(chunk));
            done();
          },
        });
        const result = await f.client.convertToStream(
          { sources: [input], toFormats: ["json", "md", "html"], imageExportMode: "referenced" },
          output,
          true
        );
        expect(result.success).toBe(true);
        // Relocation only affects the archive, preserving the original result.
        const original = JSON.parse(result.outputs?.json || "null");
        expect(original.pictures[0].image.uri).toContain(outputDir);
        expect(original.metadata.exactPath).toBe(original.pictures[0].image.uri);
        expect(await readFile(input, "utf8")).toBe(source);
        archive = Buffer.concat(chunks);
      }
      const files = unzip(archive);
      const document = JSON.parse(files[`${stem}.json`]?.toString() || "null");
      const assetName = `${stem}.json.assets/${stem}_artifacts/image.png`;
      expect(document.pictures[0].image.uri).toBe(assetName);
      expect(document.metadata.list[0].uri).toBe(assetName);
      expect(files[assetName]).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
      expect(document.name).toBe(stem);
      expect(document.description).toBe(source);
      expect(document.metadata.exactPath).toContain(outputDir);
      expect(document.metadata.sentence).toBe(`keep ${document.metadata.exactPath} unchanged`);
      expect(document.metadata.external.uri).toBe(`${document.metadata.exactPath}.unowned`);
      expect(document.metadata.structured.uri).toEqual({ value: "$&/$$" });
      const markdown = files[`${stem}.md`]?.toString() || "";
      const markdownUri = markdown.match(/!\[Image\]\(([^)]+)\)/)?.[1] || "";
      expect(markdown).toContain(source);
      expect(decodeURIComponent(markdownUri)).toBe(`${stem}.md.assets/${stem}_artifacts/image.png`);
      expect(files[decodeURIComponent(markdownUri)]).toBeDefined();
      const html = files[`${stem}.html`]?.toString() || "";
      const htmlUri = html.match(/<img src="([^"]+)"/)?.[1] || "";
      expect(decodeURIComponent(htmlUri)).toBe(`${stem}.html.assets/${stem}_artifacts/image.png`);
      expect(files[decodeURIComponent(htmlUri)]).toBeDefined();
      expect(Object.keys(files)).toHaveLength(6);
      expect(await readdir(outputDir)).toEqual([]);
    }
  }
);

it("requires a ZIP for streamed referenced assets before publishing bytes", async () => {
  const f = await fixture();
  const chunks: Buffer[] = [];
  const output = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  await expect(
    f.client.convertToStream(
      { sources: [f.input], toFormats: ["md"], imageExportMode: "referenced" },
      output
    )
  ).rejects.toThrow("Referenced image assets require ZIP output");
  expect(chunks).toEqual([]);
  expect(output.destroyed).toBe(true);
  expect(await readdir(f.outputDir)).toEqual([]);
  const zipChunks: Buffer[] = [];
  const zipOutput = new Writable({
    write(chunk, _encoding, done) {
      zipChunks.push(Buffer.from(chunk));
      done();
    },
  });
  const result = await f.client.convertToStream(
    { sources: [f.input], toFormats: ["md"], imageExportMode: "referenced" },
    zipOutput,
    true
  );
  expect(result.success).toBe(true);
  expect(Object.keys(unzip(Buffer.concat(zipChunks)))).toHaveLength(2);
  expect(result.outputFiles).toEqual([]);
  expect(await readdir(f.outputDir)).toEqual([]);
});

it.skipIf(process.platform === "win32")(
  "preserves literal quoted filenames while escaping archive image URIs",
  async () => {
    const f = await fixture();
    const filename = "odd '()&\".pdf";
    const result = await f.client.convertToFile(Buffer.from("literal names"), filename, {
      to_formats: ["md", "json"],
      image_export_mode: "referenced",
    });
    expect(result.success).toBe(true);
    const files = unzip(await collect(result.fileStream));
    const markdown = files["odd '()&\".md"]?.toString() || "";
    const reference = "odd%20%27%28%29%26%22.md.assets/odd%20%27%28%29%26%22_artifacts/image.png";
    expect(markdown).toContain(`![Image](${reference})`);
    expect(files[decodeURIComponent(reference)]).toBeDefined();
    const json = JSON.parse(files["odd '()&\".json"]?.toString() || "null");
    expect(json.pictures[0].image.uri).toBe(
      "odd '()&\".json.assets/odd '()&\"_artifacts/image.png"
    );
    expect(files[json.pictures[0].image.uri]).toBeDefined();
    expect(await readdir(f.outputDir)).toEqual([]);
  }
);
