import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProcessAbortError } from "../../src/cli/process-runner";
import { NativeError, createNativeClient } from "../../src/native-entry";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), run: vi.fn() }));
vi.mock("../../src/native/runtime", () => ({ verifyNativeRuntime: mocks.verify }));
vi.mock("../../src/native/sandbox", () => ({ runNativeProcess: mocks.run }));
const directories: string[] = [];
const identity = {
  profile: "fixture",
  engine: "docling-rs",
  version: "2.53.1",
  commit: "fixture",
  platform: "linux-x64",
  executableSha256: "a".repeat(64),
  manifestSha256: "b".repeat(64),
  isolation: "bubblewrap",
};
const config = { executable: "/installed/docling-rs", modelDirectory: "/installed/models" };
function published(result: { outputDirectory?: string }): string {
  if (!result.outputDirectory) throw new Error("Expected a published job");
  return result.outputDirectory;
}
function document(pages = [1]) {
  return {
    schema_name: "DoclingDocument",
    version: "1.10.0",
    name: "source",
    origin: { mimetype: "text/plain", binary_hash: 123, filename: "source.pdf" },
    body: {
      self_ref: "#/body",
      children: [{ $ref: "#/texts/0" }],
      content_layer: "body",
      name: "_root_",
      label: "unspecified",
    },
    furniture: {
      self_ref: "#/furniture",
      children: [],
      content_layer: "furniture",
      name: "_root_",
      label: "unspecified",
    },
    groups: [],
    pictures: [],
    tables: [],
    key_value_items: [],
    form_items: [],
    texts: [
      {
        self_ref: "#/texts/0",
        parent: { $ref: "#/body" },
        children: [],
        content_layer: "body",
        label: "text",
        text: "Fixture text",
        orig: "Fixture text",
        prov: [
          {
            page_no: pages[0],
            bbox: { l: 0, t: 20, r: 20, b: 0, coord_origin: "BOTTOMLEFT" },
            charspan: [0, 12],
          },
        ],
      },
    ],
    pages: Object.fromEntries(
      pages.map((page) => [page, { page_no: page, size: { width: 612, height: 792 } }])
    ),
  };
}
async function output(work: string, partial = false) {
  await writeFile(join(work, "output/source.md"), "Fixture text\n");
  await writeFile(join(work, "output/source.json"), JSON.stringify(document()));
  return {
    success: true,
    exitCode: 0,
    signal: null,
    stdout: "/work/output/source.md\n/work/output/source.json\n",
    stderr: `start: /work/input/source.pdf (${partial ? 32 : 1} ${partial ? "pages" : "page"})\n${partial ? "partial" : "ok"}: /work/input/source.pdf -> /work/output/source.md, /work/output/source.json (0.1s)\n${partial ? "warning: /work/input/source.pdf: document budget expired after 1 of 32 pages\n" : ""}batch: ${partial ? "0 converted, 0 failed, 1 partial" : "1 converted, 0 failed"}\n`,
  };
}
async function fixture(name = "caller.pdf") {
  const directory = await mkdtemp(join(tmpdir(), "native-client-"));
  directories.push(directory);
  const input = join(directory, name);
  await writeFile(input, "%PDF-1.4\nfixture bytes\n%%EOF\n");
  return { directory, input, outputDirectory: join(directory, "converted") };
}
beforeEach(() => {
  mocks.verify
    .mockReset()
    .mockResolvedValue({ identity, ...config, bubblewrapPath: "/usr/bin/bwrap" });
  mocks.run.mockReset().mockImplementation((_runtime, work) => output(work));
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

it("publishes only job-owned files and preserves literal caller filenames and stale outputs", async () => {
  const paths = await fixture("literal $(printf NEVER) résumé.pdf");
  await writeFile(join(paths.directory, "source.md"), "caller-owned sentinel");
  const result = await createNativeClient(config).convertFile(paths.input, {
    outputDirectory: paths.outputDirectory,
  });
  expect(result.status).toBe("success");
  expect(result.input.filename).toBe(basename(paths.input));
  expect(result.input.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(result.input.sha256).not.toBe("123");
  expect(result.document).toEqual(document());
  expect(result.files.map((file) => file.path).sort()).toEqual(["source.json", "source.md"]);
  expect(await readFile(join(published(result), "source.md"), "utf8")).toBe("Fixture text\n");
  expect(await readFile(join(paths.directory, "source.md"), "utf8")).toBe("caller-owned sentinel");
  const args = mocks.run.mock.calls[0][2];
  expect(args.at(-1)).toBe("/work/input/source.pdf");
  expect(args).toContain("--no-url-fetch");
  expect(args).not.toContain(paths.input);
  expect(
    (await readdir(paths.outputDirectory)).every((name) => name.startsWith("docling-native-"))
  ).toBe(true);
});

it("keeps concurrent same-basename conversions and per-request options isolated", async () => {
  const left = await fixture();
  const right = await fixture();
  const client = createNativeClient(config);
  const [a, b] = await Promise.all([
    client.convertFile(left.input, { outputDirectory: left.outputDirectory, formats: ["md"] }),
    client.convertFile(right.input, {
      outputDirectory: left.outputDirectory,
      formats: ["json"],
      pageRange: [1, 1],
    }),
  ]);
  expect(a.outputDirectory).not.toBe(b.outputDirectory);
  expect(await readdir(published(a))).toEqual(["source.md"]);
  expect(await readdir(published(b))).toEqual(["source.json"]);
  expect(a.document).toBeUndefined();
  expect(b.document).toEqual(document());
  expect(mocks.verify).toHaveBeenCalledTimes(2);
});

it("preserves native partial success despite exit zero and existing output files", async () => {
  const paths = await fixture();
  mocks.run.mockImplementation((_runtime, work) => output(work, true));
  const result = await createNativeClient(config).convertFile(paths.input, {
    outputDirectory: paths.outputDirectory,
    documentTimeoutSeconds: 1,
  });
  expect(result.status).toBe("partial_success");
  expect(result.coverage).toMatchObject({ expected: 32, completed: [1], complete: false });
  expect(result.warnings.length).toBeGreaterThan(0);
  expect(result.outputDirectory).toBeDefined();
});

it("returns ordinary converter failure without publishing an empty job", async () => {
  const paths = await fixture();
  mocks.run.mockResolvedValue({
    success: false,
    exitCode: 1,
    signal: null,
    stdout: "",
    stderr:
      "start: /work/input/source.pdf\nerror: /work/input/source.pdf: corrupt PDF\nbatch: 0 converted, 1 failed\n",
  });
  const result = await createNativeClient(config).convertFile(paths.input, {
    outputDirectory: paths.outputDirectory,
  });
  expect(result.status).toBe("failure");
  expect(result.outputDirectory).toBeUndefined();
  expect(result.files).toEqual([]);
  expect(await readdir(paths.outputDirectory)).toEqual([]);
});

it.each(["md", "json"] as const)(
  "publishes only validated files when requested %s is malformed",
  async (format) => {
    const paths = await fixture();
    mocks.run.mockImplementation(async (_runtime, work) => {
      const processResult = await output(work);
      await writeFile(
        join(work, `output/source.${format}`),
        format === "json" ? "{broken" : "![missing](https://example.invalid/image.png)"
      );
      return processResult;
    });
    const result = await createNativeClient(config).convertFile(paths.input, {
      outputDirectory: paths.outputDirectory,
    });
    expect(result.status).toBe("partial_success");
    const surviving = format === "md" ? "source.json" : "source.md";
    expect(result.files.map((file) => file.path)).toEqual([surviving]);
    expect(await readdir(published(result))).toEqual([surviving]);
    expect(result.warnings.some((warning) => warning.includes("validation failed"))).toBe(true);
  }
);

it.each(["abort", "timeout"])(
  "cleans staging after %s without publishing results",
  async (kind) => {
    const paths = await fixture();
    const controller = new AbortController();
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    mocks.run.mockImplementation(
      (_runtime, _work, _args, { signal }) =>
        new Promise((_resolve, reject) => {
          started();
          if (signal.aborted) reject(new ProcessAbortError());
          else
            signal.addEventListener("abort", () => reject(new ProcessAbortError()), { once: true });
        })
    );
    const operation = createNativeClient(config).convertFile(paths.input, {
      outputDirectory: paths.outputDirectory,
      signal: controller.signal,
      timeoutMs: kind === "timeout" ? 100 : 5000,
    });
    const assertion = expect(operation).rejects.toMatchObject({
      code: kind === "timeout" ? "TIMEOUT" : "ABORTED",
    });
    if (kind === "abort") {
      await start;
      controller.abort();
    }
    await assertion;
    expect(await readdir(paths.outputDirectory)).toEqual([]);
    expect(await readFile(paths.input, "utf8")).toContain("fixture bytes");
  }
);

it("never falls back when runtime verification fails", async () => {
  const paths = await fixture();
  mocks.verify.mockRejectedValue(new NativeError("RUNTIME_INTEGRITY", "wrong model digest"));
  await expect(
    createNativeClient(config).convertFile(paths.input, { outputDirectory: paths.outputDirectory })
  ).rejects.toMatchObject({ code: "RUNTIME_INTEGRITY" });
  expect(mocks.run).not.toHaveBeenCalled();
  expect(await readdir(paths.outputDirectory)).toEqual([]);
});

it("refuses a symlink destination without touching its target", async () => {
  const paths = await fixture();
  const alias = join(paths.directory, "output-alias");
  await symlink(paths.directory, alias, "dir");
  await expect(
    createNativeClient(config).convertFile(paths.input, { outputDirectory: alias })
  ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  expect(await readFile(paths.input, "utf8")).toContain("fixture bytes");
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([
  { formats: [] },
  { formats: ["md", "md"] },
  { formats: ["html"] },
  { timeoutMs: 0 },
  { timeoutMs: Number.POSITIVE_INFINITY },
  { timeoutMs: 900001 },
  { pageRange: [3, 1] },
  { pageRange: [0, 1] },
  { pageRange: [1, 1.5] },
  { documentTimeoutSeconds: 0 },
  { pipeline: "vlm" },
])("rejects unsupported options before execution: %j", async (options) => {
  await expect(
    createNativeClient(config).convertFile("input.pdf", {
      outputDirectory: "/tmp/not-used",
      ...options,
    } as never)
  ).rejects.toMatchObject({ code: "INVALID_CONFIGURATION" });
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.verify).not.toHaveBeenCalled();
});

it("checks runtime explicitly without conversion and snapshots caller configuration", async () => {
  const mutable = { ...config };
  const client = createNativeClient(mutable);
  mutable.executable = "/changed";
  expect(await client.checkRuntime()).toEqual(identity);
  expect(mocks.verify.mock.calls[0][0].executable).toBe(config.executable);
  expect(mocks.run).not.toHaveBeenCalled();
});
