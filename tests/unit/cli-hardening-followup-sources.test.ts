import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { createCLIClient } from "../../src/cli-entry";
import { ProcessAbortError, ProcessTimeoutError } from "../../src/cli/process-runner";

const directories: string[] = [];
const clients: ReturnType<typeof createCLIClient>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  clients.splice(0).forEach((client) => client.destroy());
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        })
    )
  );
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "cli-followup-sources-"));
  directories.push(directory);
  const executable = join(directory, "converter.mjs");
  await copyFile(resolve("tests/fixtures/cli-stub.mjs"), executable);
  await chmod(executable, 0o700);
  const log = join(directory, "calls.jsonl");
  await writeFile(`${executable}.json`, JSON.stringify({ log }));
  const outputDir = join(directory, "incoming", "outputs");
  const client = createCLIClient({ doclingPath: executable, outputDir, timeout: 5000 });
  clients.push(client);
  // Warm the public lazy-initialization path before any test lowers its deadline.
  // Explicit initialize() alone does not populate that cache.
  await expect(client.convertWithProgress({ sources: [], toFormats: ["md"] })).rejects.toThrow(
    "Sources and output formats are required"
  );
  const commands: string[][] = [];
  client.progress.on("command-built", ({ args }) => commands.push(args));
  return { directory, client, outputDir, commands, log };
}
function destination() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  return { stream, bytes: () => Buffer.concat(chunks) };
}
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback address");
  return `http://127.0.0.1:${address.port}`;
}

it.each(["progress", "stream"])(
  "accepts directory inputs beneath an ancestor output root via %s",
  async (method) => {
    const f = await fixture();
    const incoming = join(f.directory, "nested", "incoming");
    await mkdir(incoming, { recursive: true });
    await writeFile(join(incoming, "caller.pdf"), "ancestor output root");
    const output = destination();
    const options = { sources: [incoming], output: f.directory, toFormats: ["md"] as const };
    const result =
      method === "progress"
        ? await f.client.convertWithProgress({ ...options, toFormats: [...options.toFormats] })
        : await f.client.convertToStream(
            { ...options, toFormats: [...options.toFormats] },
            output.stream,
            true
          );
    expect(result.success).toBe(true);
    expect(f.commands).toHaveLength(1);
    expect(await readFile(join(incoming, "caller.pdf"), "utf8")).toBe("ancestor output root");
  }
);

it.each([
  [
    "https://docs.google.com/document/d/example_ID/edit",
    "https://docs.google.com/document/d/example_ID/export?format=docx",
  ],
  [
    "https://docs.google.com/spreadsheets/d/example_ID/edit",
    "https://docs.google.com/spreadsheets/d/example_ID/export?format=xlsx",
  ],
  [
    "https://docs.google.com/presentation/d/example_ID/edit",
    "https://docs.google.com/presentation/d/example_ID/export?format=pptx",
  ],
  [
    "https://drive.google.com/file/d/example_ID/view",
    "https://drive.google.com/uc?export=download&id=example_ID",
  ],
  [
    "https://example.test/document/d/example_ID/edit",
    "https://example.test/document/d/example_ID/edit",
  ],
])("preserves remote export normalization for %s", async (source, expected) => {
  const f = await fixture();
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response("exported document", {
        headers: { "content-disposition": 'attachment; filename="exported.pdf"' },
      })
  );
  try {
    for (const method of ["progress", "stream"] as const) {
      fetch.mockClear();
      const options = { sources: [source], toFormats: ["md", "text"] as const };
      const output = destination();
      const result =
        method === "progress"
          ? await f.client.convertWithProgress({ ...options, toFormats: [...options.toFormats] })
          : await f.client.convertToStream(
              { ...options, toFormats: [...options.toFormats] },
              output.stream,
              true
            );
      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(expected);
    }
  } finally {
    fetch.mockRestore();
  }
});

it.each(["progress", "stream"])(
  "recursively expands supported directory sources with isolated deterministic inventories via %s",
  async (method) => {
    const f = await fixture();
    const incoming = join(f.directory, "incoming");
    const inputs = [
      ["a/duplicate.pdf", "first duplicate"],
      ["b/duplicate.pdf", "second duplicate"],
      ["root.DOCX", "office file"],
      ["thumbnail.png", "image file"],
    ] as const;
    for (const [name, bytes] of [
      ...inputs,
      ["ignored.exe", "unsupported"],
      ["~$lock.docx", "Word lock"],
      ["outputs/stale.pdf", "old output"],
    ]) {
      const path = join(incoming, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    if (process.platform !== "win32") {
      await symlink(incoming, join(incoming, "cycle"), "dir");
      await symlink(f.outputDir, join(incoming, "output-alias"), "dir");
      await symlink(join(f.outputDir, "stale.pdf"), join(incoming, "output-file.pdf"));
    }
    const options = { sources: [incoming], toFormats: ["md", "text"] as const };
    const output = destination();
    const result =
      method === "progress"
        ? await f.client.convertWithProgress({ ...options, toFormats: [...options.toFormats] })
        : await f.client.convertToStream(
            { ...options, toFormats: [...options.toFormats] },
            output.stream,
            true
          );
    expect(result.success).toBe(true);
    expect(f.commands.map((args) => basename(args.at(-1) || ""))).toEqual(
      inputs.flatMap(([name]) => [basename(name), basename(name)])
    );
    const snapshots = f.commands.map((args) => args.at(-1) || "");
    expect(new Set(snapshots).size).toBe(4);
    for (const input of snapshots)
      await expect(readFile(input)).rejects.toMatchObject({ code: "ENOENT" });
    if (method === "progress") {
      expect(result.outputFiles).toHaveLength(8);
      const contents = await Promise.all(
        (result.outputFiles || []).map((path) => readFile(path, "utf8"))
      );
      expect(contents).toEqual(inputs.flatMap(([, bytes]) => [bytes, bytes]));
      expect(new Set(result.outputFiles).size).toBe(8);
    } else {
      const files = unzipSync(output.bytes());
      expect(Object.keys(files)).toHaveLength(8);
      expect(Object.values(files).map((bytes) => Buffer.from(bytes).toString())).toEqual(
        inputs.flatMap(([, bytes]) => [bytes, bytes])
      );
      expect(result.outputFiles).toEqual([]);
      expect(await readdir(f.outputDir)).toEqual(["stale.pdf"]);
    }
    for (const [name, bytes] of inputs)
      expect(await readFile(join(incoming, name), "utf8")).toBe(bytes);
    expect(await readFile(join(f.outputDir, "stale.pdf"), "utf8")).toBe("old output");
    expect(options.sources).toEqual([incoming]);
    expect(options.toFormats).toEqual(["md", "text"]);
  }
);

it("honors fromFormats and keeps caller files when directory and output roots coincide", async () => {
  const f = await fixture();
  await mkdir(f.outputDir, { recursive: true });
  await writeFile(join(f.outputDir, "original.PDF"), "caller pdf");
  await writeFile(join(f.outputDir, "notes.md"), "caller markdown");
  const first = await f.client.convertWithProgress({
    sources: [f.outputDir],
    output: f.outputDir,
    fromFormats: ["pdf"],
    toFormats: ["md"],
  });
  expect(first.success).toBe(true);
  const second = await f.client.convertWithProgress({
    sources: [f.outputDir],
    output: f.outputDir,
    fromFormats: [],
    toFormats: ["text"],
  });
  expect(second.success).toBe(true);
  expect(f.commands.map((args) => basename(args.at(-1) || ""))).toEqual([
    "original.PDF",
    "notes.md",
    "original.PDF",
  ]);
  expect(second.outputFiles).toHaveLength(2);
  expect(await readFile(join(f.outputDir, "original.PDF"), "utf8")).toBe("caller pdf");
  expect(await readFile(join(f.outputDir, "notes.md"), "utf8")).toBe("caller markdown");
});

it("cleans an empty directory job without starting a converter", async () => {
  const f = await fixture();
  const empty = join(f.directory, "empty");
  await mkdir(empty);
  await expect(
    f.client.convertWithProgress({ sources: [empty], toFormats: ["md"] })
  ).rejects.toThrow("No supported files");
  expect(f.commands).toEqual([]);
  expect(await readdir(f.outputDir)).toEqual([]);
});

it.each(["progress", "stream"])(
  "snapshots each single-use URL once and honors disposition filenames/headers via %s",
  async (method) => {
    const f = await fixture();
    let requests = 0;
    const base = await serve((request, response) => {
      requests++;
      expect(request.headers.authorization).toBe("Bearer test-value");
      if (requests > 1) {
        response.writeHead(410).end("already used");
        return;
      }
      response.setHeader("Content-Disposition", 'attachment; filename="invoice.pdf"');
      response.end(`revision ${requests}`);
    });
    const options = {
      sources: [`${base}/different.pdf`],
      toFormats: ["md", "text"] as const,
      headers: JSON.stringify({ Authorization: "Bearer test-value" }),
    };
    const output = destination();
    const result =
      method === "progress"
        ? await f.client.convertWithProgress({ ...options, toFormats: [...options.toFormats] })
        : await f.client.convertToStream(
            { ...options, toFormats: [...options.toFormats] },
            output.stream,
            true
          );
    expect(result.success).toBe(true);
    expect(result.outputs).toMatchObject({ markdown: "revision 1", text: "revision 1" });
    expect(requests).toBe(1);
    expect(f.commands.map((args) => args.at(-1))).toEqual([
      expect.stringContaining("invoice.pdf"),
      expect.stringContaining("invoice.pdf"),
    ]);
    expect(f.commands[0]?.at(-1)).toBe(f.commands[1]?.at(-1));
    if (method === "progress")
      expect(result.outputFiles?.map((path) => basename(path))).toEqual([
        "invoice.md",
        "invoice.txt",
      ]);
    else expect(Object.keys(unzipSync(output.bytes()))).toEqual(["invoice.md", "invoice.txt"]);
    await expect(readFile(f.commands[0]?.at(-1) || "")).rejects.toMatchObject({ code: "ENOENT" });
  }
);

it.each([
  ["/download", 'attachment; filename="invoice.pdf"', "invoice"],
  ["/fallback.pdf", "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf", "résumé"],
  ["/fallback.pdf", 'attachment; filename="../../escape.pdf"', "fallback"],
  ["/fallback.pdf", 'attachment; filename="..\\escape.pdf"', "fallback"],
  ["/fallback.pdf", 'attachment; filename="C:escape.pdf"', "fallback"],
  ["/fallback.pdf", "attachment; filename*=UTF-8''..%2Fescape.pdf", "fallback"],
  ["/encoded%20name.pdf", "attachment", "encoded name"],
  ["/download", "attachment", "download"],
  ["/..%2Fescape.pdf", "attachment", "document"],
])("resolves safe remote names for %s and %s", async (path, disposition, stem) => {
  const f = await fixture();
  const base = await serve((_request, response) => {
    response.setHeader("Content-Disposition", disposition);
    response.end("remote bytes");
  });
  const result = await f.client.convertWithProgress({
    sources: [`${base}${path}`],
    toFormats: ["md"],
  });
  expect(result.success).toBe(true);
  expect(result.outputFiles?.map((path) => basename(path))).toEqual([`${stem}.md`]);
  expect(result.outputs?.markdown).toBe("remote bytes");
});

it("reuses a URL snapshot even when that URL occurs more than once in sources", async () => {
  const f = await fixture();
  let requests = 0;
  const base = await serve((_request, response) => response.end(`revision ${++requests}`));
  const url = `${base}/input.pdf`;
  const result = await f.client.convertWithProgress({
    sources: [url, url],
    toFormats: ["md", "text"],
  });
  expect(result.success).toBe(true);
  expect(requests).toBe(1);
  expect(result.outputs).toMatchObject({
    markdown: "revision 1revision 1",
    text: "revision 1revision 1",
  });
  expect(new Set(f.commands.map((args) => args.at(-1))).size).toBe(1);
  expect(result.outputFiles).toHaveLength(4);
});

it.each(["[]", '{"Authorization":1}', '"../../escape.pdf"'])(
  "rejects invalid string request headers %s before fetching and cleans the job",
  async (headers) => {
    const f = await fixture();
    let requests = 0;
    const base = await serve((_request, response) => {
      requests++;
      response.end("unexpected");
    });
    await expect(
      f.client.convertWithProgress({ sources: [`${base}/input.pdf`], toFormats: ["md"], headers })
    ).rejects.toThrow("JSON object of string values");
    expect(requests).toBe(0);
    expect(f.commands).toEqual([]);
    expect(await readdir(f.outputDir)).toEqual([]);
  }
);

it.each(["headers", "body"])(
  "bounds elapsed download time including stalled %s and removes partial inputs",
  async (stall) => {
    const f = await fixture();
    f.client.updateConfig({ timeout: 1000 });
    let closed = false;
    const base = await serve((_request, response) => {
      response.on("close", () => {
        closed = true;
      });
      if (stall === "body") {
        response.writeHead(200);
        response.write("partial bytes");
      }
    });
    const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const started = Date.now();
    await expect(
      f.client.convertWithProgress({ sources: [`${base}/input.pdf`], toFormats: ["md"] })
    ).rejects.toBeInstanceOf(ProcessTimeoutError);
    expect(Date.now() - started).toBeLessThan(5000);
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(f.commands).toEqual([]);
    expect(await readdir(f.outputDir)).toEqual([]);
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signals);
  }
);

it.each(["http", "truncated"])(
  "cancels and cleans a failed %s transfer before conversion",
  async (failure) => {
    const f = await fixture();
    let closed = false;
    const base = await serve((request, response) => {
      response.on("close", () => {
        closed = true;
      });
      if (failure === "http") {
        response.writeHead(503);
        response.write("not finished");
      } else {
        response.on("finish", () => request.socket.destroy());
        response.writeHead(200, { "Content-Length": 100 });
        response.end("truncated");
      }
    });
    await expect(
      f.client.convertWithProgress({ sources: [`${base}/input.pdf`], toFormats: ["md"] })
    ).rejects.toThrow(failure === "http" ? "HTTP 503" : /terminated|fetch failed|socket/i);
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(f.commands).toEqual([]);
    expect(await readdir(f.outputDir)).toEqual([]);
  }
);

it("honors timeout zero for the entire download and conversion", async () => {
  const f = await fixture();
  f.client.updateConfig({ timeout: 0 });
  const base = await serve((_request, response) => {
    response.writeHead(200);
    response.write("slow ");
    void delay(200).then(() => response.end("body"));
  });
  const result = await f.client.convertWithProgress({
    sources: [`${base}/input.pdf`],
    toFormats: ["md"],
  });
  expect(result.success).toBe(true);
  expect(result.outputs?.markdown).toBe("slow body");
});

it("aborts an active download on a destination disconnect and removes stream/signal observers", async () => {
  const f = await fixture();
  let started = false;
  let closed = false;
  const base = await serve((_request, response) => {
    started = true;
    response.on("close", () => {
      closed = true;
    });
    response.write("partial");
  });
  const output = destination();
  const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const operation = f.client.convertToStream(
    { sources: [`${base}/input.pdf`], toFormats: ["md"] },
    output.stream
  );
  const rejected = expect(operation).rejects.toThrow(/premature|closed/i);
  await vi.waitFor(() => expect(started).toBe(true));
  output.stream.destroy();
  await rejected;
  await vi.waitFor(() => expect(closed).toBe(true));
  expect(f.commands).toEqual([]);
  expect(await readdir(f.outputDir)).toEqual([]);
  expect(output.bytes()).toHaveLength(0);
  expect(output.stream.listenerCount("error")).toBe(0);
  expect(output.stream.listenerCount("close")).toBe(0);
  expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signals);
});

it("retains parent cancellation identity during a URL snapshot", async () => {
  const f = await fixture();
  let started = false;
  const base = await serve((_request, response) => {
    started = true;
    response.write("partial");
  });
  const operation = f.client.convertWithProgress({
    sources: [`${base}/input.pdf`],
    toFormats: ["md"],
  });
  const rejected = expect(operation).rejects.toBeInstanceOf(ProcessAbortError);
  await vi.waitFor(() => expect(started).toBe(true));
  process.emit("SIGINT", "SIGINT");
  await rejected;
  expect(f.commands).toEqual([]);
  expect(await readdir(f.outputDir)).toEqual([]);
});
