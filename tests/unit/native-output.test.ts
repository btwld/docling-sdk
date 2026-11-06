import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProcessRunResult } from "../../src/cli/process-runner";
import type { NativeInputSnapshot } from "../../src/native/input";
import { NATIVE_LIMITS } from "../../src/native/limits";
import { inspectNativeOutputs } from "../../src/native/output";
import type { NativeFormat } from "../../src/native/types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=",
  "base64"
);
const asset = "source_artifacts/image_000000.png";

function document(pages: number[] = [1]): Record<string, unknown> {
  return {
    schema_name: "DoclingDocument",
    version: "1.10.0",
    name: "source",
    origin: {
      mimetype: "text/plain",
      binary_hash: Number("18154206005618002290"),
      filename: "source",
    },
    furniture: {
      self_ref: "#/furniture",
      children: [],
      content_layer: "furniture",
      name: "_root_",
      label: "unspecified",
    },
    body: {
      self_ref: "#/body",
      children: [{ $ref: "#/pictures/0" }],
      content_layer: "body",
      name: "_root_",
      label: "unspecified",
    },
    groups: [],
    texts: [],
    pictures: [
      {
        self_ref: "#/pictures/0",
        parent: { $ref: "#/body" },
        children: [],
        content_layer: "body",
        label: "picture",
        prov: [],
        captions: [],
        references: [],
        footnotes: [],
        annotations: [],
        image: {
          mimetype: "image/png",
          dpi: 96,
          size: { width: 1, height: 1 },
          uri: `data:image/png;base64,${png.toString("base64")}`,
        },
      },
    ],
    tables: [],
    key_value_items: [],
    form_items: [],
    pages: Object.fromEntries(
      pages.map((page_no) => [String(page_no), { page_no, size: { width: 612, height: 792 } }])
    ),
  };
}

function protocol(
  format = "pdf",
  count: number | undefined = 1,
  partial = false
): ProcessRunResult {
  const label = `/work/input/source.${format}`;
  const paths = "/work/output/source.md, /work/output/source.json";
  return {
    stdout: "/work/output/source.md\n/work/output/source.json\n",
    stderr: `start: ${label}${format === "pdf" && count !== undefined ? ` (${count} ${count === 1 ? "page" : "pages"})` : ""}\n${partial ? "partial" : "ok"}: ${label} -> ${paths} (0.1s${format === "pdf" ? ", 100 ms/page" : ""})\n${partial ? "batch: 0 converted, 0 failed, 1 partial" : "batch: 1 converted, 0 failed"}\n`,
    exitCode: 0,
    signal: null,
    success: true,
  };
}

async function fixture(format: NativeInputSnapshot["format"] = "pdf", pages: number[] = [1]) {
  const root = await mkdtemp(join(tmpdir(), "native-output-"));
  directories.push(root);
  const output = join(root, "output");
  await mkdir(join(output, "source_artifacts"), { recursive: true });
  const value = document(pages);
  await writeFile(join(output, "source.md"), `ALPHA\n\n![Image](${asset})\n`);
  await writeFile(join(output, "source.json"), JSON.stringify(value));
  await writeFile(join(output, asset), png);
  const input: NativeInputSnapshot = {
    path: join(root, "input", `source.${format}`),
    filename: `Original file.${format}`,
    format,
    size: 111,
    sha256: "a".repeat(64),
    ...(format === "pptx" ? { expectedPages: 2 } : {}),
  };
  const run = protocol(format, pages.length);
  return {
    root,
    output,
    value,
    input,
    run,
    inspect: (
      formats: readonly NativeFormat[] = ["md", "json"],
      range?: readonly [number, number]
    ) => inspectNativeOutputs(output, input, formats, run, range),
    json: (value: unknown) => writeFile(join(output, "source.json"), JSON.stringify(value)),
    markdown: (text: string) => writeFile(join(output, "source.md"), text),
  };
}

describe("native output ownership and status boundary", () => {
  it("validates and hashes the closed inventory while preserving upstream JSON and embedded images", async () => {
    const test = await fixture();
    const before = await readFile(join(test.output, "source.json"));
    const result = await test.inspect();
    expect(result.status).toBe("success");
    expect(result.files.map((file) => file.path)).toEqual(["source.md", "source.json", asset]);
    for (const file of result.files) {
      const bytes = await readFile(join(test.output, file.path));
      expect(file.size).toBe(bytes.length);
      expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    expect(result.document).toEqual(test.value);
    expect(result.document).not.toHaveProperty("status");
    expect(result.coverage).toEqual({
      basis: "engine-reported",
      expected: 1,
      completed: [1],
      complete: true,
    });
    expect(await readFile(join(test.output, "source.json"))).toEqual(before);
    expect(result.document?.origin).toEqual(test.value.origin);
    expect(result.document?.origin).not.toHaveProperty("sha256");
  });

  it.each(["md", "json"] as const)(
    "returns only requested %s plus owned assets, while validating both emitted formats",
    async (format) => {
      const test = await fixture();
      const result = await test.inspect([format]);
      expect(result.status).toBe("success");
      expect(result.files.map((file) => file.kind)).toEqual([format, "asset"]);
      expect("document" in result).toBe(format === "json");
      expect(await readFile(join(test.output, "source.json"), "utf8")).toBe(
        JSON.stringify(test.value)
      );
    }
  );

  it("accepts ordinary empty Markdown and document collections", async () => {
    const test = await fixture("docx", []);
    const value = document([]);
    value.pictures = [];
    (value.body as Record<string, unknown>).children = [];
    await test.json(value);
    await test.markdown("");
    await rm(join(test.output, "source_artifacts"), { recursive: true });
    const result = await test.inspect();
    expect(result.status).toBe("success");
    expect(result.coverage).toEqual({ basis: "not-reported", completed: [] });
    expect(result.files).toHaveLength(2);
  });

  it("does not infer DOCX pagination from JSON or diagnostics", async () => {
    const test = await fixture("docx", []);
    const result = await test.inspect();
    expect(result.status).toBe("success");
    expect(result.coverage).toEqual({ basis: "not-reported", completed: [] });
  });

  it("uses the package slide count to distinguish complete and silently skipped PPTX slides", async () => {
    const complete = await fixture("pptx", [1, 2]);
    expect((await complete.inspect()).status).toBe("success");
    const missing = await fixture("pptx", [1]);
    const result = await missing.inspect();
    expect(result.status).toBe("partial_success");
    expect(result.coverage).toEqual({
      basis: "office-package",
      expected: 2,
      completed: [1],
      complete: false,
    });
  });

  it("recognizes a zero-exit 1-of-32 partial result and preserves its warning", async () => {
    const test = await fixture();
    Object.assign(test.run, protocol("pdf", 32, true));
    test.run.stderr = test.run.stderr.replace(
      "batch:",
      "warning: /work/input/source.pdf: document timeout of 1.000s exceeded after 1 of 32 pages; the output holds the pages processed\nbatch:"
    );
    const result = await test.inspect();
    expect(result.status).toBe("partial_success");
    expect(result.coverage).toEqual({
      basis: "engine-reported",
      expected: 32,
      completed: [1],
      complete: false,
    });
    expect(result.warnings.join(" ")).toContain("after 1 of 32 pages");
  });

  it("never upgrades explicit partial protocol even when page counts agree", async () => {
    const test = await fixture();
    Object.assign(test.run, protocol("pdf", 1, true));
    expect((await test.inspect()).status).toBe("partial_success");
  });

  it("treats absent PDF page-count evidence as unknown and partial without inventing a total", async () => {
    const test = await fixture();
    test.run.stderr = test.run.stderr.replace(" (1 page)", "");
    const result = await test.inspect();
    expect(result.status).toBe("partial_success");
    expect(result.coverage).toEqual({ basis: "engine-reported", completed: [1] });
  });

  it("does not equate the count of noncontiguous JSON pages with complete PDF coverage", async () => {
    const test = await fixture("pdf", [1, 3]);
    const result = await test.inspect();
    expect(result.status).toBe("partial_success");
    expect(result.coverage.complete).toBe(false);
  });

  it("preserves the requested PDF range and compares source numbering against the selected count", async () => {
    const test = await fixture("pdf", [3, 4]);
    const range = [3, 7] as const;
    const result = await test.inspect(["md", "json"], range);
    expect(result.status).toBe("success");
    expect(result.coverage).toEqual({
      basis: "engine-reported",
      requested: [3, 7],
      expected: 2,
      completed: [3, 4],
      complete: true,
    });
    expect(range).toEqual([3, 7]);
  });

  it.each([
    "warning: OCR unavailable; continuing without OCR",
    "docling-pdf: warning: TableFormer failed; using geometric tables",
    "Error in cpuinfo: failed to parse processor information from /proc/cpuinfo",
    "docling-pdf: no fallback font face on this host — text without an embedded font is drawn as boxes",
    "\u001b[1;31m2026-11-06 [E:onnxruntime:, inference_session.cc:3309 operator()] Exception during initialization: [ONNXRuntimeError] : 1 : FAIL : Secure opened-file canonicalization requires procfs at /proc/self/fd/3\u001b[m",
  ])("does not promote degradation diagnostics to success", async (warning) => {
    const test = await fixture();
    test.run.stderr = test.run.stderr.replace("ok:", `${warning}\nok:`);
    const result = await test.inspect();
    expect(result.status).toBe("partial_success");
    expect(result.warnings).toContain(warning);
  });

  it("allows routine native font/raster diagnostics without making an OCR quality claim", async () => {
    const test = await fixture();
    test.run.stderr = test.run.stderr.replace(
      "ok:",
      "docling-pdf fallback font: Sans → /usr/share/fonts/font.ttf\ndocling-pdf: page 1: not rendered by the Rust raster (visible text)\nok:"
    );
    expect((await test.inspect()).status).toBe("success");
  });

  it("returns a normal conversion failure for the pinned error and final batch protocol", async () => {
    const test = await fixture();
    await rm(test.output, { recursive: true });
    await mkdir(test.output);
    Object.assign(test.run, {
      stdout: "",
      stderr:
        "start: /work/input/source.pdf\nerror: /work/input/source.pdf: pdf: not a readable PDF\naborting the batch (--abort-on-error)\nbatch: 0 converted, 1 failed\n",
      exitCode: 1,
      success: false,
    });
    const result = await test.inspect();
    expect(result.status).toBe("failure");
    expect(result.files).toEqual([]);
    expect(result.document).toBeUndefined();
  });

  it.each([
    "no-summary",
    "wrong-batch-size",
    "conflicting-summary",
    "wrong-label",
    "wrong-output",
    "partial-with-ok",
    "after-summary",
    "no-start",
    "duplicate-start",
    "duplicate-outcome",
    "out-of-order",
    "stdout-json",
    "unexpected-exit",
    "signal",
    "panic",
  ])("rejects unknown or conflicting execution protocol: %s", async (kind) => {
    const test = await fixture();
    if (kind === "no-summary") test.run.stderr = "";
    if (kind === "wrong-batch-size")
      test.run.stderr = test.run.stderr.replace("1 converted", "2 converted");
    if (kind === "conflicting-summary") test.run.stderr += "batch: 0 converted, 1 failed\n";
    if (kind === "wrong-label")
      test.run.stderr = test.run.stderr.replaceAll("source.pdf", "other.pdf");
    if (kind === "wrong-output")
      test.run.stdout = test.run.stdout.replace("source.md", "../outside.md");
    if (kind === "partial-with-ok")
      test.run.stderr = test.run.stderr.replace(
        "batch: 1 converted, 0 failed",
        "batch: 0 converted, 0 failed, 1 partial"
      );
    if (kind === "after-summary") test.run.stderr += "ok: stale result\n";
    if (kind === "no-start") test.run.stderr = test.run.stderr.split("\n").slice(1).join("\n");
    if (kind === "duplicate-start")
      test.run.stderr = `start: /work/input/source.pdf\n${test.run.stderr}`;
    if (kind === "duplicate-outcome")
      test.run.stderr = test.run.stderr.replace("batch:", "ok: duplicate\nbatch:");
    if (kind === "out-of-order") {
      const lines = test.run.stderr.split("\n");
      [lines[0], lines[1]] = [lines[1] ?? "", lines[0] ?? ""];
      test.run.stderr = lines.join("\n");
    }
    if (kind === "stdout-json") test.run.stdout = JSON.stringify(test.value);
    if (kind === "unexpected-exit") {
      test.run.exitCode = 2;
      test.run.success = false;
    }
    if (kind === "signal") test.run.signal = "SIGTERM";
    if (kind === "panic") {
      test.run.stderr = "thread panicked\n";
      test.run.exitCode = 101;
      test.run.success = false;
    }
    await expect(test.inspect()).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
  });

  it.each(["extra.txt", "../literal\\escape", "other_artifacts/image_000000.png"])(
    "rejects extra output paths %s",
    async (path) => {
      const test = await fixture();
      const target = path.startsWith("../")
        ? join(test.output, "literal\\escape")
        : join(test.output, path);
      if (path.startsWith("other")) await mkdir(join(test.output, "other_artifacts"));
      await writeFile(target, "unexpected");
      await expect(test.inspect()).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    }
  );

  it.each(["file-symlink", "directory-symlink", "root-symlink", "hardlink"])(
    "rejects output ownership violation: %s",
    async (kind) => {
      const test = await fixture();
      const host = join(test.root, "host");
      await writeFile(host, png);
      if (kind === "file-symlink" || kind === "hardlink") {
        await rm(join(test.output, asset));
        if (kind === "hardlink") await link(host, join(test.output, asset));
        else await symlink(host, join(test.output, asset));
      }
      if (kind === "directory-symlink") {
        await rm(join(test.output, "source_artifacts"), { recursive: true });
        await symlink(test.root, join(test.output, "source_artifacts"));
      }
      if (kind === "root-symlink") {
        const directory = join(test.root, "linked-output");
        await symlink(test.output, directory);
        await expect(
          inspectNativeOutputs(directory, test.input, ["md", "json"], test.run)
        ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
        return;
      }
      await expect(test.inspect()).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    }
  );

  it("bounds total output bytes before reading oversized files", async () => {
    const test = await fixture();
    await truncate(join(test.output, "source.json"), NATIVE_LIMITS.outputBytes + 1);
    await expect(test.inspect()).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
      message: expect.stringContaining("limit"),
    });
  });

  it("bounds the complete inventory file count", async () => {
    const test = await fixture();
    await Promise.all(
      Array.from({ length: NATIVE_LIMITS.outputFiles }, (_, index) =>
        writeFile(
          join(test.output, `source_artifacts/image_${String(index).padStart(6, "0")}.png`),
          png
        )
      )
    );
    await expect(test.inspect()).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
      message: expect.stringContaining("limit"),
    });
  });

  it.each(["svg", "html", "emf", "bin"])(
    "rejects unsupported or active asset type %s explicitly",
    async (extension) => {
      const test = await fixture();
      await writeFile(
        join(test.output, `source_artifacts/image_000001.${extension}`),
        "<svg onload='alert(1)'/>"
      );
      await expect(test.inspect()).rejects.toMatchObject({
        code: "INVALID_OUTPUT",
        message: expect.stringContaining("Unsupported native image asset type"),
      });
    }
  );

  it("rejects active content disguised as a raster and unreferenced asset files", async () => {
    const test = await fixture();
    await writeFile(join(test.output, asset), "<svg/>");
    await expect(test.inspect()).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    await writeFile(join(test.output, asset), png);
    await writeFile(join(test.output, "source_artifacts/image_000001.png"), png);
    await expect(test.inspect()).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
      message: expect.stringContaining("unreferenced"),
    });
  });

  it.each([
    ["png", png.subarray(0, 33)],
    ["jpg", Buffer.from([255, 216, 255, 217])],
    ["tif", Buffer.from([73, 73, 42, 0, 8, 0, 0, 0])],
  ] as const)(
    "rejects truncated %s containers despite recognized magic",
    async (extension, bytes) => {
      const test = await fixture();
      await rm(join(test.output, asset));
      await writeFile(join(test.output, `source_artifacts/image_000000.${extension}`), bytes);
      await expect(test.inspect()).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    }
  );

  it.each([
    "schema",
    "version",
    "array",
    "root",
    "page",
    "geometry",
    "reference",
    "provenance",
    "remote-image",
    "active-image",
  ])("does not publish invalid JSON: %s; valid Markdown remains partial", async (kind) => {
    const test = await fixture();
    const value = test.value;
    if (kind === "schema") value.schema_name = "ConversionResult";
    if (kind === "version") value.version = "1.9.0";
    if (kind === "array") value.tables = undefined;
    if (kind === "root") value.body = {};
    if (kind === "page") value.pages = { "1": { page_no: 2, size: { width: 1, height: 1 } } };
    if (kind === "geometry") value.pages = { "1": { page_no: 1, size: { width: -1, height: 1 } } };
    if (kind === "reference")
      (value.body as Record<string, unknown>).children = [{ $ref: "#/texts/999" }];
    const picture = (value.pictures as Record<string, unknown>[])[0] as Record<string, unknown>;
    if (kind === "provenance")
      picture.prov = [
        { page_no: 9, bbox: { l: 0, t: 0, r: 1, b: 1, coord_origin: "TOPLEFT" }, charspan: [0, 0] },
      ];
    if (kind === "remote-image")
      (picture.image as Record<string, unknown>).uri = "https://example.org/picture.png";
    if (kind === "active-image") {
      (picture.image as Record<string, unknown>).uri = "data:image/svg+xml;base64,PHN2Zy8+";
      (picture.image as Record<string, unknown>).mimetype = "image/svg+xml";
    }
    await test.json(value);
    const result = await test.inspect();
    expect(result.status).toBe("partial_success");
    expect(result.document).toBeUndefined();
    expect(result.files.map((file) => file.kind)).toEqual(["md", "asset"]);
    expect(result.warnings.join(" ")).toContain("JSON validation failed");
  });

  it("validates internal JSON even if only Markdown was requested", async () => {
    const test = await fixture();
    await writeFile(join(test.output, "source.json"), "{broken");
    expect((await test.inspect(["md"])).status).toBe("partial_success");
  });

  it.each([
    "https://example.org/a.png",
    "//example.org/a.png",
    "../outside.png",
    "/tmp/a.png",
    "file:///tmp/a.png",
    "source_artifacts/image_000001.png",
    "source_artifacts/%2e%2e/outside.png",
    "data:image/png;base64,aGVsbG8=",
  ])("rejects unowned Markdown image %s while retaining validated JSON", async (uri) => {
    const test = await fixture();
    await test.markdown(`![Image](${uri})`);
    const result = await test.inspect();
    expect(result.status).toBe("partial_success");
    expect(result.files.map((file) => file.kind)).toEqual(["json"]);
    expect(result.warnings.join(" ")).toContain("Markdown validation failed");
  });

  it.each([`![Image][asset]\n\n[asset]: ${asset}`, `![Image](<${asset}> "caption")`])(
    "validates local image references with supported Markdown syntax",
    async (markdown) => {
      const test = await fixture();
      await test.markdown(markdown);
      expect((await test.inspect()).status).toBe("success");
    }
  );

  it.each([
    "![Image][remote]\n\n[remote]: https://example.org/image.png",
    `<img alt="Image" src="${asset}">`,
    '<img src="https://example.org/image.png">',
    `<img src="${asset}" srcset="https://example.org/2x.png 2x">`,
    '<svg><image href="https://example.org/image.png"/></svg>',
  ])("rejects remote reference and HTML images", async (markdown) => {
    const test = await fixture();
    await test.markdown(markdown);
    expect((await test.inspect()).status).toBe("partial_success");
  });

  it("allows ordinary remote hyperlinks and image examples inside code", async () => {
    const test = await fixture();
    await test.markdown(
      `[Link](https://example.org/)\n\n\`![Code](https://example.org/inline.png)\`\n\n\`\`\`md\n![Code](https://example.org/fenced.png)\n\`\`\`\n\n![Image](${asset})`
    );
    expect((await test.inspect()).status).toBe("success");
  });

  it("does not treat backticks inside an image destination as code outside the image", async () => {
    const test = await fixture();
    await test.markdown(`![Image](\`outside/\`${asset})`);
    const result = await test.inspect();
    expect(result.status).toBe("partial_success");
    expect(result.files.map((file) => file.kind)).toEqual(["json"]);
  });

  it("returns failure when neither requested format validates", async () => {
    const test = await fixture();
    await writeFile(join(test.output, "source.json"), "broken");
    await test.markdown("![Image](https://example.org/a.png)");
    const result = await test.inspect();
    expect(result.status).toBe("failure");
    expect(result.files).toEqual([]);
  });

  it("does not call a missing internal format a complete conversion", async () => {
    const test = await fixture();
    await rm(join(test.output, "source.json"));
    expect((await test.inspect(["md"])).status).toBe("partial_success");
  });
});
