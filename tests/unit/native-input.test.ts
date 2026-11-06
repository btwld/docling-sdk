import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotNativeInput } from "../../src/native/input";
import { NATIVE_LIMITS } from "../../src/native/limits";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock("fflate");
  vi.doUnmock("saxes");
  vi.resetModules();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

const rns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pns = "http://schemas.openxmlformats.org/presentationml/2006/main";
const wns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const relationships = (body: string): string =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
const rel = (id: string, type: string, target: string, mode = ""): string =>
  `<Relationship Id="${id}" Type="${rns}/${type}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ""}/>`;

function office(format: "docx" | "pptx" = "docx"): Record<string, string | Uint8Array> {
  const main = format === "docx" ? "word/document.xml" : "ppt/presentation.xml";
  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "_rels/.rels": relationships(rel("main", "officeDocument", main)),
  };
  if (format === "docx")
    files[main] =
      `<w:document xmlns:w="${wns}" xmlns:r="${rns}"><w:body><w:p><w:r><w:t>ALPHA &amp; OMEGA</w:t></w:r></w:p></w:body></w:document>`;
  else {
    files[main] =
      `<p:presentation xmlns:p="${pns}" xmlns:r="${rns}"><p:sldIdLst><p:sldId id="256" r:id="s1"/><p:sldId id="257" r:id="s2"/></p:sldIdLst></p:presentation>`;
    files["ppt/_rels/presentation.xml.rels"] = relationships(
      rel("s1", "slide", "slides/slide2.xml") + rel("s2", "slide", "slides/slide1.xml")
    );
    for (const number of [1, 2])
      files[`ppt/slides/slide${number}.xml`] =
        `<p:sld xmlns:p="${pns}"><p:cSld><p:spTree/></p:cSld></p:sld>`;
    // Unlisted parts must not inflate expectedPages.
    files["ppt/slides/slide9.xml"] = `<p:sld xmlns:p="${pns}"><p:cSld><p:spTree/></p:cSld></p:sld>`;
  }
  return files;
}

function zip(files: Record<string, string | Uint8Array>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, data]) => [
          name,
          typeof data === "string" ? strToU8(data) : data,
        ])
      )
    )
  );
}

async function fixture(
  data: string | Uint8Array = "%PDF-1.7\nsmall source\n%%EOF",
  filename = "Original document.PDF"
) {
  const root = await mkdtemp(join(tmpdir(), "native-input-"));
  directories.push(root);
  const input = join(root, filename);
  const destination = join(root, "private", "input");
  await writeFile(input, data);
  return { root, input, destination, snapshot: () => snapshotNativeInput(input, destination) };
}

function member(bytes: Buffer, name: string, edit: (central: number, local: number) => void): void {
  let offset = bytes.readUInt32LE(bytes.length - 6);
  while (bytes.readUInt32LE(offset) === 0x02014b50) {
    const length = bytes.readUInt16LE(offset + 28);
    if (bytes.toString("utf8", offset + 46, offset + 46 + length) === name) {
      edit(offset, bytes.readUInt32LE(offset + 42));
      return;
    }
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  throw new Error(`Missing test ZIP member ${name}`);
}

describe("native input ownership boundary", () => {
  it("snapshots exact bytes to a fixed private name, hashes bytes and preserves the caller filename", async () => {
    const test = await fixture();
    const snapshot = await test.snapshot();
    const bytes = await readFile(test.input);
    expect(snapshot).toEqual({
      path: join(test.destination, "source.pdf"),
      filename: "Original document.PDF",
      format: "pdf",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(await readFile(snapshot.path)).toEqual(bytes);
    expect((await lstat(snapshot.path)).mode & 0o777).toBe(0o600);
    await writeFile(test.input, "changed after snapshot");
    expect(await readFile(snapshot.path)).toEqual(bytes);
  });

  it.each([
    "https://example.org/document.pdf",
    "file:///tmp/document.pdf",
    "//server/document.pdf",
    "input.html",
    "input.png",
    "input.zip",
    "",
    "x\0.pdf",
  ])("rejects unsupported input %s", async (input) => {
    await expect(snapshotNativeInput(input, "/unused")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it.each(["", "plain text", "PK\u0003\u0004invalid", "%PDF-9.9\ninvalid"])(
    "rejects empty or mismatched PDF magic",
    async (bytes) => {
      const test = await fixture(bytes);
      await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  );

  it("rejects symlinks, directories and oversized sparse sources", async () => {
    const test = await fixture();
    const link = join(test.root, "linked.pdf");
    await symlink(test.input, link);
    await expect(snapshotNativeInput(link, test.destination)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const dir = join(test.root, "directory.pdf");
    await mkdir(dir);
    await expect(snapshotNativeInput(dir, test.destination)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await truncate(test.input, NATIVE_LIMITS.inputBytes + 1);
    await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses an existing destination and never overwrites it", async () => {
    const test = await fixture();
    await mkdir(test.destination, { recursive: true });
    const target = join(test.destination, "source.pdf");
    await writeFile(target, "already owned");
    await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await readFile(target, "utf8")).toBe("already owned");
  });

  it("detects source mutation through the open descriptor and removes the incomplete copy", async () => {
    const test = await fixture(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200000)]));
    const handle = await open(test.input, "r");
    const prototype = Object.getPrototypeOf(handle);
    const original = prototype.read;
    let changed = false;
    vi.spyOn(prototype, "read").mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      const result = await original.apply(this, args);
      if (!changed) {
        changed = true;
        await appendFile(test.input, "mutation");
      }
      return result;
    });
    await handle.close();
    await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(lstat(join(test.destination, "source.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("honors an aborted signal before doing filesystem work", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      snapshotNativeInput("missing.pdf", "/unused", controller.signal)
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it.each(["docx", "pptx"] as const)(
    "validates a bounded %s package without inventing Word pagination",
    async (format) => {
      const test = await fixture(zip(office(format)), `original.${format}`);
      const result = await test.snapshot();
      expect(result.format).toBe(format);
      expect(result.path).toBe(join(test.destination, `source.${format}`));
      if (format === "pptx") expect(result.expectedPages).toBe(2);
      else expect(result).not.toHaveProperty("expectedPages");
    }
  );

  it("allows ordinary external hyperlinks while resolving internal relationships within the package", async () => {
    const files = office();
    files["word/_rels/document.xml.rels"] = relationships(
      rel("link", "hyperlink", "https://example.org/", "External") +
        rel("image", "image", "../media/image.png")
    );
    files["media/image.png"] = new Uint8Array([1, 2, 3]);
    const test = await fixture(zip(files), "original.docx");
    await expect(test.snapshot()).resolves.toMatchObject({ format: "docx" });
  });

  it.each(["image", "oleObject", "attachedTemplate", "audio", "video"])(
    "rejects external fetchable %s relationships",
    async (type) => {
      const files = office();
      files["word/_rels/document.xml.rels"] = relationships(
        rel("remote", type, "https://example.org/resource", "External")
      );
      const test = await fixture(zip(files), "original.docx");
      await expect(test.snapshot()).rejects.toMatchObject({
        code: "INVALID_INPUT",
        message: expect.stringContaining("External fetchable"),
      });
    }
  );

  it.each([
    "../../outside.png",
    "file:///tmp/image.png",
    "https://example.org/image.png",
    "missing.png",
    "%2e%2e/%2e%2e/outside.png",
    "..\\image.png",
  ])("rejects non-owned internal relationship %s", async (target) => {
    const files = office();
    files["word/_rels/document.xml.rels"] = relationships(rel("image", "image", target));
    const test = await fixture(zip(files), "original.docx");
    await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not accept an existing host file as a missing package relationship target", async () => {
    const test = await fixture(zip(office()), "original.docx");
    const host = join(test.root, "host.png");
    await writeFile(host, "host-only");
    const files = office();
    files["word/_rels/document.xml.rels"] = relationships(rel("image", "image", host));
    await writeFile(test.input, zip(files));
    await expect(test.snapshot()).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("missing from the package"),
    });
  });

  it.each([
    "<!DOCTYPE w:document [<!ENTITY bomb 'expanded'>]>",
    "<!DOCTYPE w:document SYSTEM 'file:///etc/passwd'>",
  ])("rejects DTD declarations and entity expansion", async (doctype) => {
    const files = office();
    files["word/document.xml"] = doctype + files["word/document.xml"];
    const test = await fixture(zip(files), "original.docx");
    await expect(test.snapshot()).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("DTD/entity"),
    });
  });

  it.each(["../escape.xml", "/absolute.xml", "word/../escape.xml", "word\\escape.xml"])(
    "rejects ZIP member traversal %s",
    async (name) => {
      const test = await fixture(zip({ ...office(), [name]: "<x/>" }), "original.docx");
      await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  );

  it("rejects duplicate member names in both ZIP directories", async () => {
    const bytes = zip({ ...office(), "word/documenx.xml": "<x/>" });
    member(bytes, "word/documenx.xml", (central, local) => {
      bytes.write("word/document.xml", central + 46);
      bytes.write("word/document.xml", local + 30);
    });
    const test = await fixture(bytes, "original.docx");
    await expect(test.snapshot()).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("Duplicate"),
    });
  });

  it("rejects archived symlinks and incorrect CRC values", async () => {
    for (const kind of ["link", "crc"]) {
      const bytes = zip(office());
      member(bytes, "word/document.xml", (central, local) => {
        if (kind === "link") bytes.writeUInt32LE(0xa1ff0000, central + 38);
        else {
          bytes.writeUInt32LE(1, central + 16);
          bytes.writeUInt32LE(1, local + 14);
        }
      });
      const test = await fixture(bytes, "original.docx");
      await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("rejects dishonest expanded sizes while streaming compressed members", async () => {
    const bytes = zip({ ...office(), "word/bomb.xml": `<x>${"A".repeat(3 * 1024 * 1024)}</x>` });
    member(bytes, "word/bomb.xml", (central, local) => {
      bytes.writeUInt32LE(1, central + 24);
      bytes.writeUInt32LE(1, local + 22);
    });
    const test = await fixture(bytes, "original.docx");
    await expect(test.snapshot()).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("Inflated"),
    });
  });

  it("bounds declared archive counts and XML expansion before allocation", async () => {
    const bytes = zip(office());
    member(bytes, "word/document.xml", (central, local) => {
      bytes.writeUInt32LE(NATIVE_LIMITS.xmlBytes + 1, central + 24);
      bytes.writeUInt32LE(NATIVE_LIMITS.xmlBytes + 1, local + 22);
    });
    const test = await fixture(bytes, "original.docx");
    await expect(test.snapshot()).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("XML exceeds"),
    });
    const counts = zip(office());
    counts.writeUInt16LE(10001, counts.length - 14);
    counts.writeUInt16LE(10001, counts.length - 12);
    await writeFile(test.input, counts);
    await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it.each([
    "missing-slide",
    "missing-relation",
    "malformed-slide",
    "missing-slide-list",
    "duplicate-slide",
    "wrong-slide-root",
  ])("rejects PPTX %s before the engine can skip it", async (kind) => {
    const files = office("pptx");
    if (kind === "missing-slide") Reflect.deleteProperty(files, "ppt/slides/slide2.xml");
    if (kind === "missing-relation")
      files["ppt/_rels/presentation.xml.rels"] = relationships(
        rel("s1", "slide", "slides/slide2.xml")
      );
    if (kind === "malformed-slide") files["ppt/slides/slide2.xml"] = "<unclosed>";
    if (kind === "wrong-slide-root") files["ppt/slides/slide2.xml"] = "<wrong/>";
    if (kind === "missing-slide-list")
      files["ppt/presentation.xml"] = `<p:presentation xmlns:p="${pns}"/>`;
    if (kind === "duplicate-slide")
      files["ppt/_rels/presentation.xml.rels"] = relationships(
        rel("s1", "slide", "slides/slide1.xml") + rel("s2", "slide", "slides/slide1.xml")
      );
    const test = await fixture(zip(files), "original.pptx");
    await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects relationship encodings that the pinned engine would silently skip", async () => {
    const files = office("pptx");
    files["ppt/_rels/presentation.xml.rels"] = relationships(
      rel("s1", "slide", "slides/slide&#50;.xml") + rel("s2", "slide", "slides/slide1.xml")
    );
    const test = await fixture(zip(files), "original.pptx");
    await expect(test.snapshot()).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("encoded attribute"),
    });
  });

  it("cannot hide encoded relationship targets inside another quoted attribute", async () => {
    const files = office("pptx");
    files["ppt/_rels/presentation.xml.rels"] = relationships(
      rel("s1", "slide", "slides/slide&#50;.xml").replace(
        'Target="',
        `Extra=" Target='slides/slide2.xml'" Target="`
      ) + rel("s2", "slide", "slides/slide1.xml")
    );
    const test = await fixture(zip(files), "original.pptx");
    await expect(test.snapshot()).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("honors cancellation during a copy and removes its incomplete snapshot", async () => {
    const test = await fixture(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200000)]));
    const controller = new AbortController();
    const handle = await open(test.input, "r");
    const prototype = Object.getPrototypeOf(handle);
    const original = prototype.read;
    vi.spyOn(prototype, "read").mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      const result = await original.apply(this, args);
      controller.abort();
      return result;
    });
    await handle.close();
    await expect(
      snapshotNativeInput(test.input, test.destination, controller.signal)
    ).rejects.toMatchObject({ code: "ABORTED" });
    await expect(lstat(join(test.destination, "source.pdf"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each(["fflate", "saxes"])(
    "loads optional %s lazily and explains missing native configuration",
    async (dependency) => {
      vi.doMock(dependency, () => {
        throw new Error("optional dependency absent");
      });
      vi.resetModules();
      const { snapshotNativeInput: snapshot } = await import("../../src/native/input");
      const pdf = await fixture();
      await expect(snapshot(pdf.input, pdf.destination)).resolves.toMatchObject({ format: "pdf" });
      const docx = await fixture(zip(office()), "original.docx");
      await expect(snapshot(docx.input, docx.destination)).rejects.toMatchObject({
        code: "INVALID_CONFIGURATION",
        message: expect.stringContaining(dependency),
      });
      await expect(lstat(join(docx.destination, "source.docx"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  );
});
