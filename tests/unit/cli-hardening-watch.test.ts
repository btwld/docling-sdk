import { EventEmitter, once } from "node:events";
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCLIClient } from "../../src/cli-entry";

const { watch } = vi.hoisted(() => ({ watch: vi.fn() }));
// Mock only the filesystem event boundary; conversion still invokes the real SDK/runner.
vi.mock("chokidar", () => ({ watch }));
class SyntheticWatcher extends EventEmitter {
  close = vi.fn(async () => {});
}
const clients: ReturnType<typeof createCLIClient>[] = [];
const directories: string[] = [];
let watcher: SyntheticWatcher;
let beforeSignals: number[];
beforeEach(() => {
  beforeSignals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  watcher = new SyntheticWatcher();
  watch.mockReset().mockReturnValue(watcher);
});
afterEach(async () => {
  clients.splice(0).forEach((client) => client.destroy());
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
  expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(
    beforeSignals
  );
});
async function fixture(config: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "cli-watch-"));
  directories.push(directory);
  const executable = join(directory, "converter.mjs");
  await copyFile(resolve("tests/fixtures/cli-stub.mjs"), executable);
  await chmod(executable, 0o700);
  await writeFile(
    `${executable}.json`,
    JSON.stringify({ ...config, log: join(directory, "calls.jsonl") })
  );
  const client = createCLIClient({
    doclingPath: executable,
    outputDir: join(directory, "default-output"),
    defaultOptions: { to_formats: ["md"] },
  });
  clients.push(client);
  const input = join(directory, "original.pdf");
  await writeFile(input, "watched payload");
  return { directory, client, input };
}

describe("public watcher behavior", () => {
  it("closes the watcher before rejecting a throwing stop observer", async () => {
    const f = await fixture();
    const failure = new Error("stop observer failed");
    f.client.progress.on("watch-stop", () => {
      expect(watcher.close).toHaveBeenCalledTimes(1);
      throw failure;
    });
    const operation = f.client.watch(f.directory);
    const rejection = expect(operation).rejects.toBe(failure);
    f.client.destroy();
    await rejection;
    expect(watcher.listenerCount("add")).toBe(0);
  });

  it("honors recursive/output settings and closes on SIGINT without leaking listeners", async () => {
    const f = await fixture();
    const destination = join(f.directory, "watch-output");
    const operation = f.client.watch(f.directory, {
      outputDir: destination,
      recursive: false,
      debounce: 0,
    });
    expect(watch).toHaveBeenCalledWith(
      f.directory,
      expect.objectContaining({ depth: 0, ignoreInitial: true, persistent: true })
    );
    const complete = once(f.client.progress, "file-processed");
    watcher.emit("add", f.input);
    expect((await complete)[0]).toEqual({ file: f.input, success: true, status: "success" });
    expect(await readdir(destination)).toHaveLength(1);
    expect(f.client.getConfig().outputDir).toBe(join(f.directory, "default-output"));
    process.emit("SIGINT", "SIGINT");
    await operation;
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(watcher.listenerCount("add")).toBe(0);
  });

  it("debounces a burst into one conversion and destroy cancels queued changes", async () => {
    const f = await fixture();
    const commands = vi.fn();
    f.client.progress.on("command-built", commands);
    const operation = f.client.watch(f.directory, { debounce: 20 });
    const complete = once(f.client.progress, "file-processed");
    watcher.emit("change", f.input);
    watcher.emit("change", f.input);
    watcher.emit("change", f.input);
    expect((await complete)[0]).toMatchObject({ success: true });
    await delay(50);
    expect(commands).toHaveBeenCalledTimes(1);
    watcher.emit("change", f.input);
    f.client.destroy();
    await operation;
    await delay(30);
    expect(commands).toHaveBeenCalledTimes(1);
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  it.each(["**/*.pdf", "*.pdf", "original.pdf"])(
    "matches %s exactly without treating dots as wildcards",
    async (pattern) => {
      const f = await fixture();
      const detected = vi.fn();
      f.client.progress.on("file-detected", detected);
      const operation = f.client.watch(f.directory, { patterns: [pattern], debounce: 0 });
      for (const path of ["original.pdfx", "originalXpdf", "notes.docx"]) {
        watcher.emit("add", join(f.directory, path));
        watcher.emit("change", join(f.directory, path));
      }
      expect(detected).not.toHaveBeenCalled();
      const complete = once(f.client.progress, "file-processed");
      watcher.emit("add", f.input);
      await complete;
      expect(detected).toHaveBeenCalledTimes(1);
      f.client.destroy();
      await operation;
    }
  );

  it("reports actual input and converter failures while continuing the watcher", async () => {
    const f = await fixture({ files: { "original.pdf": "none" } });
    const operation = f.client.watch(f.directory);
    let complete = once(f.client.progress, "file-processed");
    watcher.emit("add", f.input);
    expect((await complete)[0]).toMatchObject({ success: false, status: "failure" });
    complete = once(f.client.progress, "file-processed");
    watcher.emit("add", join(f.directory, "missing.pdf"));
    expect((await complete)[0]).toMatchObject({
      success: false,
      error: expect.objectContaining({ code: "ENOENT" }),
    });
    process.emit("SIGTERM", "SIGTERM");
    await operation;
  });

  it("settles watcher errors and tears down its owned listeners", async () => {
    const f = await fixture();
    const operation = f.client.watch(f.directory);
    const error = new Error("filesystem watcher failed");
    const rejection = expect(operation).rejects.toBe(error);
    watcher.emit("error", error);
    await rejection;
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(watcher.eventNames()).toEqual([]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
    "rejects invalid debounce %s without opening a watcher",
    async (debounce) => {
      const f = await fixture();
      await expect(f.client.watch(f.directory, { debounce })).rejects.toThrow("Watch debounce");
      expect(watch).not.toHaveBeenCalled();
    }
  );
});

it("handles empty directories, files, and mixed PDF conversion results", async () => {
  const f = await fixture({ files: { "bad.pdf": "nonzero" } });
  const empty = join(f.directory, "empty");
  await mkdir(empty);
  expect(await f.client.processDirectory(empty)).toEqual({
    success: true,
    results: [],
    totalFiles: 0,
  });
  expect(await f.client.processDirectory(f.input)).toEqual({
    success: false,
    results: [],
    totalFiles: 0,
  });
  expect(await f.client.processDirectory(join(f.directory, "missing"))).toEqual({
    success: false,
    results: [],
    totalFiles: 0,
  });
  await writeFile(join(f.directory, "bad.pdf"), "broken payload");
  await writeFile(join(f.directory, "ignored.docx"), "ignored payload");
  const result = await f.client.processDirectory(f.directory, { to_formats: ["md"] });
  expect(result.success).toBe(false);
  expect(result.totalFiles).toBe(2);
  expect(result.results).toHaveLength(1);
  expect(result.results[0]?.document.filename).toBe(f.input);
  expect(result.results[0]?.status).toBe("success");
  expect(result.results[0]?.document.md_content).toBe("watched payload");
});
