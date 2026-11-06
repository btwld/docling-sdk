#!/usr/bin/env node
// Explicit CLI only. No npm lifecycle hook, import side effect, or installer API.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DOWNLOAD_TIMEOUT_MS = 600_000;
const INSTALL_TIMEOUT_MS = 1_800_000;
const TOOL_TIMEOUT_MS = 30_000;
const TOOL_ENV = { PATH: "/usr/bin:/bin", LC_ALL: "C" };
const TAR = "/usr/bin/tar";
const MV = "/usr/bin/mv";

function checkAbort(signal) {
  if (signal.aborted) throw signal.reason;
}

async function exists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Require an existing parent and inspect the spelling before resolve normalizes it.
// In particular, a symlink followed by /.. must never bypass this inspection.
async function destinationPath(input) {
  if (
    !input ||
    input.startsWith("-") ||
    input.includes("\0") ||
    input.includes("\\") ||
    input.split("/").some((part) => part === "..")
  ) {
    throw new Error("Destination must be a directory path without traversal or backslashes");
  }
  const destination = resolve(input);
  if (destination === "/") throw new Error("Destination already exists");
  await inspectParent(dirname(destination));
  if (await exists(destination)) throw new Error("Destination already exists (including symlinks)");
  return destination;
}

async function inspectParent(path) {
  let current = "/";
  for (const component of path.split("/").filter(Boolean)) {
    current = join(current, component);
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("Destination ancestry must contain only real directories");
    }
  }
  return lstat(path);
}

async function reviewedManifest() {
  const bundled = new URL("../dist/native.js", import.meta.url);
  if (await exists(fileURLToPath(bundled))) {
    const { nativeRuntimeManifest } = await import(bundled.href);
    return nativeRuntimeManifest;
  }
  // Development checkout only; packed npm packages contain the built native entry.
  return JSON.parse(await readFile(new URL("../src/native/profile.json", import.meta.url), "utf8"));
}

function validateManifest(profile) {
  if (
    profile?.schemaVersion !== 1 ||
    profile.platform !== "linux" ||
    profile.architecture !== "x64" ||
    profile.engine?.name !== "docling-rs" ||
    profile.engine.version !== "2.53.1" ||
    profile.executable?.path !== "docling-rs" ||
    !Array.isArray(profile.assets) ||
    profile.assets.length === 0 ||
    profile.assets.length > 64
  ) {
    throw new Error("Invalid bundled native profile");
  }
  const files = new Set();
  let total = 0;
  for (const asset of [profile.executable.archive, profile.executable, ...profile.assets]) {
    if (
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > 512 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      throw new Error("Invalid bundled size or SHA256");
    total += asset.size;
    if (asset !== profile.executable) {
      const url = new URL(asset.url);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) {
        throw new Error("Bundled downloads must use HTTPS without credentials");
      }
    }
  }
  if (total > 1024 * 1024 * 1024) throw new Error("Bundled native profile exceeds setup limit");
  for (const asset of profile.assets) {
    if (
      typeof asset.path !== "string" ||
      !/^[a-zA-Z0-9_./-]+$/.test(asset.path) ||
      asset.path.split("/").some((part) => !part || part === "." || part === "..") ||
      files.has(asset.path)
    )
      throw new Error("Invalid or colliding bundled asset path");
    files.add(asset.path);
  }
  for (const path of files) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) {
      if (files.has(parts.slice(0, index).join("/")))
        throw new Error("Colliding bundled asset paths");
    }
  }
}

// Also bounds uncooperative streams during cancellation; fetch itself receives the signal.
async function abortable(task, signal) {
  checkAbort(signal);
  let listener;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        listener = () => reject(signal.reason);
        signal.addEventListener("abort", listener, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}

async function download(asset, path, installSignal) {
  checkAbort(installSignal);
  const controller = new AbortController();
  const abort = () => controller.abort(installSignal.reason);
  installSignal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("Native download timed out")),
    DOWNLOAD_TIMEOUT_MS
  );
  const { signal } = controller;
  let reader;
  let file;
  try {
    const response = await abortable(
      fetch(asset.url, {
        signal,
        headers: { "Accept-Encoding": "identity" },
        redirect: "follow",
      }),
      signal
    );
    if (!response.body) throw new Error("Native download failed");
    reader = response.body.getReader();
    if (!response.ok) throw new Error("Native download failed");
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== asset.size)) {
      throw new Error("Native download Content-Length does not match pinned size");
    }
    file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    const hash = createHash("sha256");
    let size = 0;
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      checkAbort(signal);
      if (done) break;
      size += value.byteLength;
      if (size > asset.size) throw new Error("Native download exceeds pinned size");
      hash.update(value);
      await file.writeFile(value);
    }
    if (size !== asset.size || hash.digest("hex") !== asset.sha256) {
      throw new Error("Native download size or SHA256 does not match reviewed profile");
    }
    checkAbort(signal);
  } finally {
    clearTimeout(timer);
    installSignal.removeEventListener("abort", abort);
    controller.abort(new Error("Native download closed"));
    // Do not wait for a remote server's cancellation acknowledgement.
    if (reader)
      void reader.cancel().catch(() => {
        /* A failed stream is already closed. */
      });
    if (file) await file.close();
  }
}

async function tool(command, args, signal) {
  checkAbort(signal);
  return new Promise((resolveTool, reject) => {
    // Empty inherited environment prevents TAR_OPTIONS, loader overrides and tool hooks.
    const child = spawn(command, args, {
      shell: false,
      env: TOOL_ENV,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let failure;
    const stop = (reason) => {
      failure ??= reason;
      child.kill("SIGKILL");
    };
    const abort = () => stop(signal.reason);
    const timer = setTimeout(() => stop(new Error("Native setup tool timed out")), TOOL_TIMEOUT_MS);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (data) => {
      stdout += data.toString("utf8");
      if (stdout.length > 16384) stop(new Error("Native archive listing exceeds limit"));
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString("utf8");
      if (stderr.length > 16384) stop(new Error("Native setup tool output exceeds limit"));
    });
    child.on("error", (error) => {
      failure ??= error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (code !== 0 || stderr) reject(new Error("Native setup system tool failed"));
      else resolveTool(stdout);
    });
  });
}

async function verifyExecutable(path, expected, signal) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const entry = await file.stat();
    if (
      !entry.isFile() ||
      entry.nlink !== 1 ||
      entry.size !== expected.size ||
      !(entry.mode & 0o111)
    ) {
      throw new Error("Native archive executable type, size or permissions are invalid");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size = 0;
    while (true) {
      checkAbort(signal);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > expected.size) throw new Error("Native executable exceeds pinned size");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (size !== expected.size || hash.digest("hex") !== expected.sha256) {
      throw new Error("Native executable SHA256 does not match reviewed profile");
    }
    // The archive cannot request setuid/setgid or broader installation permissions.
    await file.chmod(0o700);
  } finally {
    await file.close();
  }
  await access(path, constants.X_OK);
}

async function prepare(destination, profile, signal) {
  const parent = dirname(destination);
  const before = await inspectParent(parent);
  // Staging is on the destination filesystem, and never visible under its final name.
  const stage = await mkdtemp(join(parent, ".docling-native-"));
  try {
    await chmod(stage, 0o700);
    const archive = join(stage, "runtime.tar.gz");
    const executable = join(stage, "docling-rs");
    const models = join(stage, "models");
    await mkdir(models, { mode: 0o700 });
    await download(profile.executable.archive, archive, signal);
    const listing = await tool(
      TAR,
      ["--list", "--verbose", "--numeric-owner", "--full-time", "--gzip", "--file", archive],
      signal
    );
    // GNU tar's C-locale listing: one regular executable, exact name and byte size.
    // No links, directories, duplicate members, absolute names or special modes.
    const match =
      /^(-[rwx-]{9}) \d+\/\d+\s+(\d+) \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} docling-rs\n$/.exec(
        listing
      );
    if (!match || !match[1].includes("x") || Number(match[2]) !== profile.executable.size) {
      throw new Error(
        "Native archive must contain exactly one ordinary executable named docling-rs"
      );
    }
    await tool(
      TAR,
      [
        "--extract",
        "--gzip",
        "--file",
        archive,
        "--directory",
        stage,
        "--no-same-owner",
        "--no-same-permissions",
        "--no-acls",
        "--no-xattrs",
        "--no-selinux",
        "--",
        "docling-rs",
      ],
      signal
    );
    await verifyExecutable(executable, profile.executable, signal);
    await rm(archive);
    for (const asset of profile.assets) {
      checkAbort(signal);
      const path = join(models, asset.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await download(asset, path, signal);
    }
    const receipt = {
      schemaVersion: 1,
      profile: profile.id,
      manifestSha256: createHash("sha256").update(JSON.stringify(profile)).digest("hex"),
      executable: join(destination, "docling-rs"),
      modelDirectory: join(destination, "models"),
      manifest: profile,
    };
    // The model verifier enforces a closed inventory: receipt belongs beside models/.
    await writeFile(join(stage, "install-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    checkAbort(signal);
    const after = await inspectParent(parent);
    if (before.dev !== after.dev || before.ino !== after.ino)
      throw new Error("Destination parent changed during setup");
    if (await exists(destination))
      throw new Error("Destination already exists; nothing was overwritten");
    // Node rename() can replace an existing empty directory. GNU mv -nT uses the
    // Linux no-replace rename operation; no cross-device copy is possible here.
    // Skip is exit 0, so also require that our staging inode actually moved.
    const staged = await lstat(stage);
    let publicationError;
    try {
      await tool(MV, ["--no-clobber", "--no-target-directory", "--", stage, destination], signal);
    } catch (error) {
      publicationError = error;
    }
    // A signal may arrive after rename commits but before the child closes.
    // Reconcile that exact owned inode: a committed install is success, while
    // a skipped/failed move preserves the destination and the original failure.
    if (await exists(stage))
      throw publicationError ?? new Error("Destination collision; nothing was overwritten");
    const published = await exists(destination);
    if (!published || published.dev !== staged.dev || published.ino !== staged.ino || !published.isDirectory()) {
      throw publicationError ?? new Error("Native installation publication failed");
    }
    return {
      executable: receipt.executable,
      modelDirectory: receipt.modelDirectory,
      receipt: join(destination, "install-receipt.json"),
    };
  } finally {
    // Only ever remove the uniquely owned private staging name, never destination.
    await rm(stage, { recursive: true, force: true });
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      "Usage: node scripts/prepare-native-runtime.mjs <destination-directory>\n" +
        "Explicitly download and verify the reviewed docling-rs 2.53.1 Linux x64 runtime, models, fonts and licenses.\n" +
        "Requires an existing symlink-free parent, GNU /usr/bin/tar and /usr/bin/mv. Destination must not exist.\n" +
        "Conversion additionally requires compatible glibc/libstdc++ and administrator-provided Bubblewrap.\n"
    );
    return;
  }
  if (args.length !== 1) throw new Error("Expected one destination directory; use --help");
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Reviewed native setup supports Linux x64 only");
  }
  const destination = await destinationPath(args[0]);
  const profile = await reviewedManifest();
  validateManifest(profile);
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Native setup interrupted by SIGINT"));
  const terminate = () => controller.abort(new Error("Native setup interrupted by SIGTERM"));
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const timer = setTimeout(
    () => controller.abort(new Error("Native setup timed out")),
    INSTALL_TIMEOUT_MS
  );
  try {
    const result = await prepare(destination, profile, controller.signal);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}

// Node resolves module symlinks, while argv retains the caller's spelling
// (notably macOS /var -> /private/var). Importing remains setup-free.
const invokedPath = process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => undefined);
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Native setup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
