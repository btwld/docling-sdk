import { once } from "node:events";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { watch, type FSWatcher } from "chokidar";
import { afterEach, expect, it, vi } from "vitest";
import { createCLIClient } from "../../src/cli-entry";

// Wrap only to await actual readiness and inspect shutdown. Every event comes
// from real chokidar observing filesystem writes, never from injected emits.
vi.mock("chokidar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("chokidar")>();
  return { ...actual, watch: vi.fn(actual.watch) };
});
const directories: string[] = [];
const clients: ReturnType<typeof createCLIClient>[] = [];
afterEach(async () => {
  clients.splice(0).forEach((client) => client.destroy());
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
  vi.mocked(watch).mockClear();
});

async function verifyWatchLayout(layout: string) {
  const directory = await mkdtemp(join(tmpdir(), "cli-real-watch-"));
  directories.push(directory);
  const incoming = join(directory, "incoming");
  await mkdir(incoming);
  const executable = join(directory, "converter.mjs");
  await copyFile(resolve("tests/fixtures/cli-stub.mjs"), executable);
  await chmod(executable, 0o700);
  const log = join(directory, "calls.jsonl");
  await writeFile(`${executable}.json`, JSON.stringify({ delay: 250, log }));
  const outputDir = ["same-root", "root-alias"].includes(layout)
    ? incoming
    : layout === "output-alias"
      ? join(directory, "separate-output")
      : join(incoming, "outputs");
  await mkdir(outputDir, { recursive: true });
  const watchRoot = layout === "root-alias" ? join(directory, "watched-alias") : incoming;
  if (layout === "root-alias") await symlink(incoming, watchRoot, "dir");
  if (layout === "output-alias") await symlink(outputDir, join(incoming, "output-link"), "dir");
  const client = createCLIClient({
    doclingPath: executable,
    outputDir: layout === "nested-override" ? join(directory, "default-output") : outputDir,
    defaultOptions: { to_formats: ["md"] },
    timeout: 5000,
  });
  clients.push(client);
  await client.initialize();
  const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const detected: string[] = [];
  const processed: Array<{ file: string; success: boolean }> = [];
  client.progress.on("file-detected", ({ file }) => detected.push(file));
  client.progress.on("file-processed", (result) => processed.push(result));
  const operation = client.watch(watchRoot, {
    ...(layout === "nested-override" && { outputDir }),
    patterns: ["**/*.pdf", "**/*.md"],
    debounce: 20,
  });
  const watcher = vi.mocked(watch).mock.results.at(-1)?.value as FSWatcher;
  await once(watcher, "ready");
  const original = join(watchRoot, "original.pdf");
  // Publish complete caller files atomically. Writing directly into the watched
  // directory can legitimately emit both add and change before writeFile settles.
  const stagedInput = join(directory, "staged-input.pdf");
  const publishInput = async (path: string, content: string) => {
    await writeFile(stagedInput, content);
    await rename(stagedInput, path);
  };
  await publishInput(original, "original caller bytes");
  if (layout.endsWith("alias")) {
    // Real child startup can exceed Vitest's 1s polling default under coverage.
    // Keep every output-ownership assertion; allow the configured 5s job to settle.
    await vi.waitFor(() => expect(processed.length).toBeGreaterThan(0), { timeout: 10000 });
    // Aliased directories can produce both initial add and change notifications.
    // What must never occur is detection/conversion of an SDK-owned snapshot.
    await delay(1000);
    expect(new Set(detected)).toEqual(new Set([original]));
    expect(processed.every((result) => result.file === original && result.success)).toBe(true);
    const completed = processed.length;
    await delay(650);
    expect(processed).toHaveLength(completed);
    expect(await readFile(original, "utf8")).toBe("original caller bytes");
    client.destroy();
    await operation;
    expect(watcher.closed).toBe(true);
    expect(watcher.getWatched()).toEqual({});
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signals);
    return;
  }
  await vi.waitFor(() => expect(processed).toHaveLength(1), { timeout: 10000 });
  // Caller inputs in the configured output root must remain observable, too.
  const sibling = join(
    layout === "root-alias"
      ? watchRoot
      : layout === "output-alias"
        ? join(watchRoot, "output-link")
        : outputDir,
    "docling-job-caller.pdf"
  );
  await publishInput(sibling, "another caller input");
  await vi.waitFor(() => expect(processed).toHaveLength(2), { timeout: 10000 });
  const complete = once(client.progress, "file-processed");
  await publishInput(original, "updated caller bytes");
  expect((await complete)[0]).toMatchObject({ file: original, success: true });
  // Hold longer than the converter's latency: the old implementation would
  // detect each new input snapshot and continually launch another process.
  await delay(650);
  expect(detected).toEqual([original, sibling]);
  expect(processed).toEqual([
    { file: original, success: true, status: "success" },
    { file: sibling, success: true, status: "success" },
    { file: original, success: true, status: "success" },
  ]);
  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(calls.filter((call) => !call.version)).toHaveLength(3);
  expect(await readFile(original, "utf8")).toBe("updated caller bytes");
  expect(await readFile(sibling, "utf8")).toBe("another caller input");
  expect(
    (await readdir(outputDir, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("docling-job-")
    )
  ).toHaveLength(3);
  client.destroy();
  await operation;
  expect(watcher.closed).toBe(true);
  expect(watcher.getWatched()).toEqual({});
  expect(watcher.listenerCount("add")).toBe(0);
  expect(watcher.listenerCount("change")).toBe(0);
  expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signals);
}

it.each(["nested-default", "same-root", "nested-override"])(
  "real watcher excludes jobs with %s",
  verifyWatchLayout
);
it.skipIf(process.platform === "win32").each(["root-alias", "output-alias"])(
  "real watcher excludes jobs through %s",
  verifyWatchLayout
);
