import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import profile from "../../src/native/profile.json";

const source = fileURLToPath(new URL("../../scripts/prepare-native-runtime.mjs", import.meta.url));
const pin = (bytes: Buffer) => ({
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});
const archiveUrl = "https://fixtures.invalid/runtime.tar.gz";
const binary = Buffer.from("tiny reviewed native binary fixture\n");
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
let root: string;
let script: string;
let destination: string;
let harness: string;
let manifest: typeof profile;
let downloads: Record<string, string>;
let children: ChildProcess[];

const harnessSource = `
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const config = JSON.parse(await readFile(new URL('./fixture.json', import.meta.url), 'utf8'));
if (config.publishCollision || config.publishSignal) {
  const realSpawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    if (command === '/usr/bin/mv' && config.publishCollision) {
      if (config.publishCollision === 'symlink') fs.symlinkSync(config.target, config.destination);
      else fs.mkdirSync(config.destination);
      fs.writeFileSync(config.ready, String(fs.lstatSync(config.destination).ino));
    }
    const child = realSpawn(command, args, options);
    if (command === '/usr/bin/mv' && config.publishSignal) {
      child.once('exit', (code) => { if (code === 0) process.emit(config.publishSignal); });
    }
    return child;
  };
  syncBuiltinESMExports();
}
if (config.platform) Object.defineProperty(process, 'platform', { value: config.platform });
if (config.arch) Object.defineProperty(process, 'arch', { value: config.arch });
globalThis.fetch = async (url, options) => {
  const index = Object.keys(config.downloads).indexOf(url);
  process.stderr.write('FETCH:' + index + '\\n');
  if (index < 0) throw new Error('Unexpected download');
  if (index === config.collisionAt) {
    if (config.collisionKind === 'symlink') await symlink(config.target, config.destination);
    else {
      await mkdir(config.destination);
      if (config.collisionKind !== 'empty') await writeFile(config.destination + '/preserved', 'keep');
    }
  }
  const original = Buffer.from(config.downloads[url], 'base64');
  const mode = index === (config.at ?? 1) ? config.mode : '';
  let bytes = original;
  if (mode === 'digest') { bytes = Buffer.from(original); bytes[0] ^= 1; }
  if (mode === 'short') bytes = original.subarray(0, original.length - 1);
  if (mode === 'long') bytes = Buffer.concat([original, Buffer.from('extra')]);
  if (mode === 'http') return new Response('failure', { status: 503 });
  if (mode === 'empty') return new Response(null);
  if (mode === 'fetch-failure') throw new Error('Injected network interruption');
  if (mode === 'hang') {
    await writeFile(config.ready, 'ready');
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.subarray(0, 2)); },
      cancel() { process.stderr.write('CANCELLED\\n'); }
    }));
  }
  if (mode === 'stream-failure') return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 2));
      queueMicrotask(() => controller.error(new Error('Injected broken stream')));
    }
  }));
  const headers = mode === 'content-length' ? { 'Content-Length': String(original.length + 1) } : {};
  return new Response(bytes, { headers });
};
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "native-setup-test-"));
  destination = join(root, "installed");
  script = join(root, "scripts/prepare-native-runtime.mjs");
  harness = join(root, "harness.mjs");
  children = [];
  await mkdir(dirname(script));
  await mkdir(join(root, "dist"));
  await copyFile(source, script);
  await writeFile(harness, harnessSource);
  const archive = await makeArchive();
  const assets = ["layout.onnx", "fonts/NotoSans-Regular.ttf", "fonts/OFL.txt"].map((path) => {
    const bytes = Buffer.from(`reviewed:${path}`);
    return { path, ...pin(bytes), url: `https://fixtures.invalid/${path}`, license: "fixture" };
  });
  manifest = {
    ...profile,
    executable: {
      ...profile.executable,
      ...pin(binary),
      archive: { url: archiveUrl, ...pin(archive) },
    },
    assets,
  };
  downloads = { [archiveUrl]: archive.toString("base64") };
  for (const asset of assets)
    downloads[asset.url] = Buffer.from(`reviewed:${asset.path}`).toString("base64");
});

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await rm(root, { recursive: true, force: true });
});

async function makeArchive(kind = "regular"): Promise<Buffer> {
  const work = await mkdtemp(join(root, "archive-"));
  const output = join(work, "fixture.tar.gz");
  const member = join(work, "docling-rs");
  const names = ["docling-rs"];
  if (kind === "symlink") await symlink("outside", member);
  else if (kind === "directory") await mkdir(member);
  else {
    await writeFile(member, binary);
    await chmod(member, kind === "nonexecutable" ? 0o600 : kind === "setuid" ? 0o4755 : 0o755);
  }
  if (kind === "extra") {
    await writeFile(join(work, "extra"), "unexpected");
    names.push("extra");
  }
  if (kind === "duplicate") names.push("docling-rs");
  const created = spawnSync(
    "/usr/bin/tar",
    ["--create", "--gzip", "--format=ustar", "--file", output, "--directory", work, "--", ...names],
    { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } }
  );
  expect(created.status, created.stderr.toString()).toBe(0);
  return readFile(output);
}

async function configure(config: Record<string, unknown> = {}) {
  await writeFile(
    join(root, "dist/native.js"),
    `export const nativeRuntimeManifest = ${JSON.stringify(manifest)};\n`
  );
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    join(root, "fixture.json"),
    JSON.stringify({
      downloads,
      destination,
      ready: join(root, "ready"),
      target: join(root, "target"),
      ...config,
    })
  );
}

async function start(config: Record<string, unknown> = {}, args = [destination]) {
  await configure(config);
  const child = spawn(process.execPath, ["--import", harness, script, ...args], {
    cwd: root,
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  const settled = new Promise<{
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
  }>((resolveResult, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
  });
  return { child, settled };
}

async function run(config: Record<string, unknown> = {}, args = [destination]) {
  return (await start(config, args)).settled;
}

async function assertClean() {
  await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readdir(root)).filter((name) => name.startsWith(".docling-native-"))).toEqual([]);
}

async function waitReady(child: ChildProcess) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    try {
      await lstat(join(root, "ready"));
      return;
    } catch {
      /* poll only the local fixture marker */
    }
    if (child.exitCode !== null) throw new Error("Setup exited before the download started");
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Fixture download did not start");
}

describe("explicit reviewed native setup CLI", () => {
  it("installs a verified tiny archive and closed asset inventory from the packaged manifest", async () => {
    const result = await run();
    expect(result.code, result.stderr).toBe(0);
    const paths = JSON.parse(result.stdout);
    expect(paths).toEqual({
      executable: join(destination, "docling-rs"),
      modelDirectory: join(destination, "models"),
      receipt: join(destination, "install-receipt.json"),
    });
    expect(await readFile(paths.executable)).toEqual(binary);
    expect((await lstat(destination)).mode & 0o777).toBe(0o700);
    expect((await lstat(paths.executable)).mode & 0o7777).toBe(0o700);
    const receipt = JSON.parse(await readFile(paths.receipt, "utf8"));
    expect(receipt.manifest).toEqual(manifest);
    expect(receipt.manifestSha256).toBe(
      createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
    );
    expect(await readdir(paths.modelDirectory)).toEqual(["fonts", "layout.onnx"]);
    expect(await readdir(join(paths.modelDirectory, "fonts"))).toEqual([
      "NotoSans-Regular.ttf",
      "OFL.txt",
    ]);
    for (const asset of manifest.assets) {
      expect(pin(await readFile(join(paths.modelDirectory, asset.path)))).toEqual({
        size: asset.size,
        sha256: asset.sha256,
      });
    }
    expect((await readdir(root)).some((name) => name.startsWith(".docling-native-"))).toBe(false);
  });

  it("can read reviewed source JSON in a development checkout without a built native entry", async () => {
    await configure();
    await rm(join(root, "dist/native.js"));
    await mkdir(join(root, "src/native"), { recursive: true });
    await writeFile(join(root, "src/native/profile.json"), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, ["--import", harness, script, destination], {
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(result.status, result.stderr.toString()).toBe(0);
  });

  it("has no setup side effects when imported", async () => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(source)});`],
      { env: {} }
    );
    expect(result.status, result.stderr.toString()).toBe(0);
    expect(result.stdout.length).toBe(0);
    expect(result.stderr.length).toBe(0);
    await assertClean();
  });

  it("prints conventional help without fetching or creating a destination", async () => {
    const result = await run({}, ["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).not.toContain("FETCH:");
    await assertClean();
  });

  it.each(
    [
      [],
      ["--url", "https://unreviewed.invalid"],
      ["--help", "extra"],
      ["--model=other"],
      ["--destination"],
    ].map((args) => ({ args }))
  )("rejects unsupported CLI arguments $args before download", async ({ args }) => {
    const result = await run({}, args);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("FETCH:");
    await assertClean();
  });

  it.each([{ platform: "darwin" }, { platform: "win32" }, { arch: "arm64" }])(
    "refuses unsupported hosts %j before download",
    async (host) => {
      const result = await run(host);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Linux x64 only");
      expect(result.stderr).not.toContain("FETCH:");
      await assertClean();
    }
  );

  it.each([
    "digest",
    "short",
    "long",
    "content-length",
    "stream-failure",
    "fetch-failure",
    "http",
    "empty",
  ])("cleans private staging and publishes nothing on %s", async (mode) => {
    const result = await run({ mode });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    await assertClean();
  });

  it.each([0, 2, 3])("checks archive/font/license digests, download index %i", async (at) => {
    const result = await run({ mode: "digest", at });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("SHA256");
    await assertClean();
  });

  it("checks the extracted executable digest independently of the archive digest", async () => {
    manifest.executable.sha256 = "f".repeat(64);
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("executable SHA256");
    expect(result.stderr).not.toContain("FETCH:1");
    await assertClean();
  });

  it.each(["symlink", "directory", "nonexecutable", "setuid", "extra", "duplicate"])(
    "rejects a digest-verified archive with %s members before extraction",
    async (kind) => {
      const archive = await makeArchive(kind);
      manifest.executable.archive = { url: archiveUrl, ...pin(archive) };
      downloads[archiveUrl] = archive.toString("base64");
      const result = await run();
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("exactly one ordinary executable");
      expect(result.stderr).not.toContain("FETCH:1");
      await assertClean();
    }
  );

  it.each(["SIGINT", "SIGTERM"] as const)(
    "aborts a stalled stream on %s, cleans staging and preserves existing data",
    async (signal) => {
      const { child, settled } = await start({ mode: "hang" });
      await waitReady(child);
      await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
      const stages = (await readdir(root)).filter((name) => name.startsWith(".docling-native-"));
      expect(stages).toHaveLength(1);
      expect((await lstat(join(root, required(stages[0])))).mode & 0o777).toBe(0o700);
      child.kill(signal);
      const result = await settled;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`interrupted by ${signal}`);
      expect(result.stderr).toContain("CANCELLED");
      await assertClean();
    }
  );

  it("times out a stalled stream without a published partial installation", async () => {
    // Shorten the private constant in this isolated copy; production has no override.
    await writeFile(
      script,
      (await readFile(script, "utf8")).replace(
        "const DOWNLOAD_TIMEOUT_MS = 600_000;",
        "const DOWNLOAD_TIMEOUT_MS = 150;"
      )
    );
    const result = await run({ mode: "hang" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("download timed out");
    await assertClean();
  });

  it.each(["file", "directory", "empty", "symlink", "dangling"])(
    "preserves an existing destination %s",
    async (kind) => {
      if (kind === "file") await writeFile(destination, "keep");
      else if (kind === "directory" || kind === "empty") {
        await mkdir(destination);
        if (kind === "directory") await writeFile(join(destination, "preserved"), "keep");
      } else {
        if (kind === "symlink") await writeFile(join(root, "target"), "keep");
        await symlink(join(root, "target"), destination);
      }
      const before = await lstat(destination);
      const result = await run();
      expect(result.code).toBe(1);
      expect(result.stderr).not.toContain("FETCH:");
      expect((await lstat(destination)).ino).toBe(before.ino);
      if (kind === "file") expect(await readFile(destination, "utf8")).toBe("keep");
      if (kind === "directory")
        expect(await readFile(join(destination, "preserved"), "utf8")).toBe("keep");
    }
  );

  it.each(["empty", "directory", "symlink"])(
    "preserves a %s destination created while downloading",
    async (collisionKind) => {
      await writeFile(join(root, "target"), "keep");
      const result = await run({ collisionAt: 3, collisionKind });
      expect(result.code).toBe(1);
      if (collisionKind === "symlink") {
        expect((await lstat(destination)).isSymbolicLink()).toBe(true);
        expect(await readFile(join(root, "target"), "utf8")).toBe("keep");
      } else {
        expect(await readdir(destination)).toEqual(collisionKind === "empty" ? [] : ["preserved"]);
      }
      expect((await readdir(root)).some((name) => name.startsWith(".docling-native-"))).toBe(false);
    }
  );

  it.each(["empty", "symlink"])(
    "uses no-clobber publication even if a %s appears after the final check",
    async (publishCollision) => {
      await writeFile(join(root, "target"), "keep");
      const result = await run({ publishCollision });
      expect(result.code).toBe(1);
      expect((await lstat(destination)).ino).toBe(
        Number(await readFile(join(root, "ready"), "utf8"))
      );
      if (publishCollision === "symlink") {
        expect((await lstat(destination)).isSymbolicLink()).toBe(true);
        expect(await readFile(join(root, "target"), "utf8")).toBe("keep");
      } else expect(await readdir(destination)).toEqual([]);
      expect((await readdir(root)).some((name) => name.startsWith(".docling-native-"))).toBe(false);
    }
  );

  it.each(["SIGINT", "SIGTERM"])(
    "reports a committed installation when %s arrives after publication",
    async (publishSignal) => {
      const result = await run({ publishSignal });
      expect(result.code).toBe(0);
      const installed = JSON.parse(result.stdout);
      expect(installed.executable).toBe(join(destination, "docling-rs"));
      expect(await readFile(installed.executable)).toEqual(binary);
      expect(JSON.parse(await readFile(installed.receipt, "utf8")).manifest).toEqual(manifest);
      expect((await readdir(root)).some((name) => name.startsWith(".docling-native-"))).toBe(false);
    }
  );

  it("does not mistake a skipped colliding move for committed setup after cancellation", async () => {
    const result = await run({ publishCollision: "empty", publishSignal: "SIGTERM" });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(await readdir(destination)).toEqual([]);
    expect((await lstat(destination)).ino).toBe(
      Number(await readFile(join(root, "ready"), "utf8"))
    );
    expect((await readdir(root)).some((name) => name.startsWith(".docling-native-"))).toBe(false);
  });

  it("passes a destination with shell characters as a literal path", async () => {
    destination = join(root, "install $(touch injected);' directory");
    const result = await run();
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).modelDirectory).toBe(join(destination, "models"));
    await expect(lstat(join(root, "injected"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts a conventional relative destination and prints absolute client paths", async () => {
    const result = await run({}, ["./installed"]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).executable).toBe(join(destination, "docling-rs"));
  });

  it("requires an existing destination parent without creating unrelated directories", async () => {
    const result = await run({}, [join(root, "missing-parent/install")]);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("FETCH:");
    await expect(lstat(join(root, "missing-parent"))).rejects.toMatchObject({ code: "ENOENT" });
    await assertClean();
  });

  it("rejects symlink ancestry and preserves the link and target directory", async () => {
    await mkdir(join(root, "target"));
    await symlink(join(root, "target"), join(root, "link"));
    const result = await run({}, [join(root, "link/installed")]);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("FETCH:");
    expect((await lstat(join(root, "link"))).isSymbolicLink()).toBe(true);
    expect(await readdir(join(root, "target"))).toEqual([]);
  });

  it.each(["../escape", "fonts/../escape", "/absolute", "fonts\\escape", "fonts//escape"])(
    "rejects unsafe bundled asset path %s",
    async (path) => {
      required(manifest.assets[0]).path = path;
      const result = await run();
      expect(result.code).toBe(1);
      expect(result.stderr).not.toContain("FETCH:");
      await assertClean();
    }
  );

  it("rejects conflicting file/directory paths in the bundled profile", async () => {
    required(manifest.assets[0]).path = "fonts";
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Colliding");
    await assertClean();
  });

  it("rejects traversal before path normalization, including a symlink followed by dot-dot", async () => {
    const result = await run({}, [`${root}/link/../installed`]);
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("FETCH:");
    await assertClean();
  });

  it("does not inherit tar hooks or mutate the parent environment", async () => {
    await configure();
    const envBefore = JSON.stringify(process.env);
    const marker = join(root, "tar-hook-ran");
    const result = spawnSync(process.execPath, ["--import", harness, script, destination], {
      env: {
        PATH: "/usr/bin:/bin",
        TAR_OPTIONS: `--checkpoint=1 --checkpoint-action=exec=touch ${marker}`,
      },
    });
    expect(result.status, result.stderr.toString()).toBe(0);
    await expect(lstat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.stringify(process.env) === envBefore).toBe(true);
  });
});

describe("reviewed profile font and attribution pins", () => {
  it("pins immutable direct-download fonts and OFL alongside the two exact metadata assets", () => {
    expect(profile.assets.find((asset) => asset.path === "models.json")).toMatchObject({
      size: 54178,
      sha256: "ffe84af6729843fc6666a77c628b801c6170b655858651e509081430f84dd740",
    });
    expect(profile.assets.find((asset) => asset.path === "export_record.json")).toMatchObject({
      size: 26883,
      sha256: "903740ec555190a59b9f11d4d679e2cc72d6625c04860a1065e65fccc036e029",
    });
    const fonts = profile.assets.filter((asset) => asset.path.startsWith("fonts/"));
    expect(fonts).toHaveLength(11);
    for (const font of fonts) {
      expect(font.url).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/notofonts\/noto-fonts\/[a-f0-9]{40}\//
      );
      expect(font.license).toBe("OFL-1.1");
      expect(font.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(font.size).toBeLessThan(1024 * 1024);
    }
    expect(fonts.map((font) => font.path)).toContain("fonts/OFL.txt");
    expect(fonts.map((font) => font.path)).toContain("fonts/LiberationMono-Regular.ttf");
  });
});
