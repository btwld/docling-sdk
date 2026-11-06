#!/usr/bin/env node
// Real, packed Linux SDK integration. No fake executable, loader workaround,
// application environment inheritance, or namespace-failure skip is permitted.
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), "..");
const originalSpawn = childProcess.spawn;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeCode = (error) =>
  /^[A-Z_0-9]+$/.test(error?.code ?? "") ? error.code : "VALIDATION_FAILED";
function failureEvidence(error) {
  const result = { code: safeCode(error), check: error.validationLabel ?? "operation-failed" };
  // Only sandbox startup diagnostics: never document text, full command lines
  // or inherited environments. Hash-only receipts otherwise hide host blockers.
  for (let cause = error, depth = 0; cause && depth < 4; cause = cause.cause, depth++) {
    if (typeof cause.stderr !== "string") continue;
    const lines = cause.stderr.split(/\r?\n/).filter((line) => line.startsWith("bwrap: "));
    if (lines.length) result.isolationDiagnostics = lines.join("\n").slice(0, 2048);
  }
  return result;
}
function ensure(condition, label) {
  if (!condition) {
    const error = new Error(label);
    error.validationLabel = label;
    throw error;
  }
}
async function json(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function cleanEnvironment(home) {
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home,
    TMPDIR: home,
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, "config"),
    LANG: "C.UTF-8",
  };
}

// Bound every subprocess independently. Logs contain hashes/counts only: no
// inherited environment, command lines, npm credentials, or document excerpts.
async function command(executable, args, { cwd, env, timeoutMs, receipt, diagnostics = false }) {
  const started = Date.now();
  const result = await new Promise((done, reject) => {
    const child = originalSpawn(executable, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      shell: false,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stopped;
    const stop = (reason) => {
      stopped ??= reason;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") reject(error);
      }
    };
    const timer = setTimeout(() => stop("SUBPROCESS_TIMEOUT"), timeoutMs);
    for (const [stream, append] of [
      [
        child.stdout,
        (data) => {
          stdout = Buffer.concat([stdout, data]);
        },
      ],
      [
        child.stderr,
        (data) => {
          stderr = Buffer.concat([stderr, data]);
        },
      ],
    ])
      stream.on("data", (data) => {
        append(data);
        if (stdout.length + stderr.length > 2 * 1024 * 1024) stop("SUBPROCESS_OUTPUT_LIMIT");
      });
    child.on("error", (error) => {
      stopped ??= safeCode(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, stopped, stdout, stderr });
    });
  });
  if (receipt)
    await json(receipt, {
      exitCode: result.code,
      signal: result.signal,
      stopped: result.stopped,
      elapsedMs: Date.now() - started,
      stdout: { bytes: result.stdout.length, sha256: sha256(result.stdout) },
      stderr: { bytes: result.stderr.length, sha256: sha256(result.stderr) },
    });
  ensure(
    !result.stopped && result.code === 0 && result.signal === null,
    "bounded-subprocess-failed"
  );
  return diagnostics ? result : result.stdout.toString("utf8");
}

// The pinned timing scopes also record failed attempts. Require a complete
// timing block AND clean debug diagnostics AND checked output, never model names.
const MODEL_STAGES = Object.freeze({
  "original.pdf": ["layout.predict", "tf.encoder", "tf.decode_loop", "tf.bbox"],
  "scanned.pdf": ["layout.predict", "ocr.det.net", "ocr.rec"],
});
function modelExecutionEvidence(diagnostics, expected) {
  const stages = new Map();
  let block = false;
  let blocks = 0;
  let totals = 0;
  let batches = 0;
  for (const line of diagnostics.split(/\r?\n/)) {
    if (line === "batch: 1 converted, 0 failed") {
      batches++;
      continue;
    }
    // A selected substitute font is normal for these synthetic PDFs. Missing
    // fonts, geometric tables, region-only OCR, ORT warnings/errors and retries
    // after inference failure must still reject even with all timing rows.
    const diagnostic = line.replace(/^docling-pdf fallback font: /, "docling-pdf font: ");
    ensure(
      !/\b(?:warn(?:ing)?|errors?|exceptions?|panic(?:ked)?|fail(?:ed|ure)?|unavailable|missing|not found|fall(?:ing)? back|fallback|geometric|region-scoped|timed? out|partial)\b|\[[EW]:onnxruntime:/i.test(diagnostic),
      "model-execution-degraded"
    );
    if (line === "=== DOCLING_RS timing (per stage, wall-clock) ===") {
      ensure(!block && blocks === 0, "model-execution-timing-block");
      blocks++;
      block = true;
    } else if (/^ {2}TOTAL \(summed\)\s+\d+\.\d+ ms$/.test(line)) {
      ensure(block, "model-execution-timing-total");
      totals++;
      block = false;
    } else if (block) {
      const row = /^ {2}([a-z][a-z0-9_.]*)\s+(\d+\.\d+) ms\s+(\d+\.\d+)%\s+\((\d+) calls\)$/.exec(line);
      ensure(row && !stages.has(row[1]), "model-execution-timing-row");
      const elapsedMs = Number(row[2]);
      const calls = Number(row[4]);
      ensure(
        Number.isFinite(elapsedMs) && Number.isSafeInteger(calls) && calls > 0,
        "model-execution-timing-value"
      );
      stages.set(row[1], { calls, elapsedMs });
    }
  }
  ensure(!block && blocks === 1 && totals === 1, "model-execution-complete-timing");
  ensure(batches === 1, "model-execution-complete-batch");
  for (const stage of expected)
    ensure(stages.get(stage)?.elapsedMs > 0, "model-execution-required-stage");
  return Object.fromEntries(expected.map((stage) => [stage, stages.get(stage)]));
}

function tableFormerStructureEvidence(document) {
  // Pinned assemble.rs:3466-3490 gives first-class cells only to successful
  // TableFormer grids. json.rs emits their page-space bboxes; the geometric
  // fallback's synthesized cells have no bbox, even with identical text/grid.
  ensure(document.tables.length > 0, "tableformer-structured-table-required");
  let cells = 0;
  for (const table of document.tables) {
    ensure(table.data.table_cells.length > 0, "tableformer-structured-cells-required");
    for (const cell of table.data.table_cells) {
      const box = cell.bbox;
      ensure(box?.coord_origin === "TOPLEFT" && [box.l, box.t, box.r, box.b].every(Number.isFinite) &&
        box.r > box.l && box.b > box.t, "tableformer-completed-structure-required");
      cells++;
    }
  }
  return { tables: document.tables.length, cells };
}

function refreshSandboxWork(sandboxArgs, work) {
  ensure(
    sandboxArgs?.includes("--unshare-all") && sandboxArgs.includes("--clearenv") &&
      sandboxArgs.some((arg, index) => arg === "--proc" && sandboxArgs[index + 1] === "/proc"),
    "sdk-sandbox-launch-not-observed"
  );
  const boundary = sandboxArgs.lastIndexOf("--");
  ensure(boundary > 0 && sandboxArgs[boundary + 1] === "/runtime/docling-rs", "sandbox-terminal-boundary");
  const args = [...sandboxArgs];
  let rebound = 0;
  for (let index = 0; index < boundary; index++) {
    if (args[index] === "--bind" && args[index + 2] === "/work") {
      args[index + 1] = work;
      rebound++;
    }
  }
  ensure(rebound === 1, "sdk-private-work-mount-observed");
  return args;
}

function validateFixtureContent(document, markdown, { markers = [], pageMarkers = {}, table, scan }) {
  const text = document.texts.map((item) => item.text).join("\n");
  for (const marker of markers)
    ensure(
      text.includes(marker) &&
        (markdown.includes(marker) || markdown.includes(marker.replaceAll("_", "\\_"))),
      "expected-text-marker"
    );
  for (const [page, marker] of Object.entries(pageMarkers))
    ensure(
      document.texts.some(
        (item) => item.text.includes(marker) &&
          item.prov.some((prov) => prov.page_no === Number(page))
      ),
      "expected-text-on-requested-page"
    );
  if (table) {
    const found = document.tables.find(
      (item) => item.data.num_rows === 3 && item.data.num_cols === 2
    );
    ensure(found, "three-by-two-table");
    const expected = [["Fruit", "Count"], ["Apples", "11"], ["Pears", "22"]];
    for (const [row, values] of expected.entries())
      for (const [col, value] of values.entries()) {
        ensure(
          found.data.table_cells.some(
            (cell) => cell.start_row_offset_idx === row &&
              cell.start_col_offset_idx === col && cell.text.trim() === value
          ),
          "table-cell-content"
        );
        ensure(markdown.includes(value), "markdown-table-content");
      }
  }
  if (scan)
    for (const content of [text, markdown])
      ensure(
        /ALPHA/i.test(content) && /Apples\s*11/i.test(content) && /Pears\s*22/i.test(content),
        "ocr-content-required"
      );
}

async function parent(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    ensure(
      ["--tarball", "--output", "--python"].includes(args[index]) && args[index + 1],
      "invalid-cli-option"
    );
    ensure(!options[args[index]], "duplicate-cli-option");
    options[args[index]] = args[index + 1];
  }
  ensure(
    options["--tarball"] && options["--output"] && options["--python"],
    "tarball-output-python-required"
  );
  const output = resolve(options["--output"]);
  ensure(!(await exists(output)), "evidence-directory-must-be-fresh");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const summary = {
    schemaVersion: 1,
    kind: "real-packed-native-sdk",
    status: "failed",
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    validatorSha256: sha256(await readFile(SELF)),
    cases: [],
  };
  let consumer;
  try {
    ensure(process.platform === "linux" && process.arch === "x64", "linux-x64-required");
    consumer = await mkdtemp(join(tmpdir(), "docling-real-native-"));
    const home = join(consumer, "home");
    await mkdir(home, { mode: 0o700 });
    const env = cleanEnvironment(home);
    const tarball = await realpath(resolve(options["--tarball"]));
    summary.tarballSha256 = sha256(await readFile(tarball));
    await json(join(consumer, "package.json"), {
      name: "native-validation-consumer",
      private: true,
      type: "module",
    });
    await command(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", tarball],
      {
        cwd: consumer,
        env,
        timeoutMs: 180_000,
        receipt: join(output, "consumer-install.json"),
      }
    );
    await copyFile(SELF, join(consumer, "validate.mjs"));
    const config = {
      output,
      consumer,
      // Preserve the venv executable spelling: realpath would select the system
      // Python behind its symlink and lose the pinned validation dependencies.
      python: resolve(options["--python"]),
      fixtureScript: join(ROOT, "scripts/validate-native-fixtures.py"),
      summary,
    };
    await json(join(consumer, "config.json"), config);
    await command(
      process.execPath,
      [join(consumer, "validate.mjs"), "--consumer", join(consumer, "config.json")],
      {
        cwd: consumer,
        env,
        timeoutMs: 2_700_000,
        receipt: join(output, "consumer-process.json"),
      }
    );
  } catch (error) {
    if (!(await exists(join(output, "summary.json")))) {
      summary.failure = {
        code: safeCode(error),
        check: error.validationLabel ?? "consumer-startup",
      };
      await json(join(output, "summary.json"), summary);
    } else {
      const saved = JSON.parse(await readFile(join(output, "summary.json"), "utf8"));
      error.validationLabel ??= saved.failure?.check;
    }
    throw error;
  } finally {
    if (consumer) await rm(consumer, { recursive: true, force: true });
  }
}

// /proc observations use only status/stat/exe, never environ or cmdline. A
// process identity includes its start tick, preventing PID-reuse false positives.
async function processInfo(pid) {
  try {
    const [status, statusLine, executable, executableStat] = await Promise.all([
      readFile(`/proc/${pid}/status`, "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
      readlink(`/proc/${pid}/exe`).catch(() => ""),
      stat(`/proc/${pid}/exe`).catch(() => undefined),
    ]);
    return {
      pid: Number(pid),
      parent: Number(/^PPid:\s+(\d+)$/m.exec(status)?.[1]),
      birth: statusLine.slice(statusLine.lastIndexOf(")") + 2).split(" ")[19],
      engine: basename(executable) === "docling-rs",
      executableIdentity: executableStat && `${executableStat.dev}:${executableStat.ino}`,
    };
  } catch (error) {
    if (["ENOENT", "ESRCH", "EACCES"].includes(error.code)) return undefined;
    throw error;
  }
}
async function descendants(root) {
  const entries = await readdir("/proc");
  const infos = (
    await Promise.all(entries.filter((name) => /^\d+$/.test(name)).map(processInfo))
  ).filter(Boolean);
  const selected = new Set([root]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const info of infos)
      if (selected.has(info.parent) && !selected.has(info.pid)) {
        selected.add(info.pid);
        changed = true;
      }
  }
  return infos.filter((info) => selected.has(info.pid));
}
async function waitFor(predicate, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await sleep(20);
  }
  ensure(false, label);
}
async function gone(identities) {
  await waitFor(
    async () => {
      const current = await Promise.all(identities.map((info) => processInfo(info.pid)));
      return current.every((info, index) => !info || info.birth !== identities[index].birth);
    },
    3_000,
    "native-descendant-cleanup"
  );
}
async function noRuntimeProcess(executable) {
  const identity = await stat(executable);
  const key = `${identity.dev}:${identity.ino}`;
  await waitFor(
    async () => {
      const infos = await Promise.all(
        (await readdir("/proc")).filter((name) => /^\d+$/.test(name)).map(processInfo)
      );
      return !infos.some((info) => info?.executableIdentity === key);
    },
    3_000,
    "runtime-process-survived-cleanup"
  );
}

async function tcp(host, port) {
  return new Promise((done, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("capability-control-timeout"));
    }, 5_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      done();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

async function isolationProbe(config, sandboxArgs) {
  ensure(
    sandboxArgs?.includes("--unshare-all") && sandboxArgs.includes("--proc"),
    "sdk-sandbox-launch-not-observed"
  );
  const listener = createServer((socket) => socket.destroy());
  await new Promise((done) => listener.listen(0, "127.0.0.1", done));
  const port = listener.address().port;
  const probeWork = await mkdtemp(join(config.consumer, "isolation-work-"));
  try {
    await tcp("127.0.0.1", port);
    await tcp("1.1.1.1", 443);
    const namespaces = {};
    for (const name of ["net", "pid", "mnt", "user"])
      namespaces[name] = await readlink(`/proc/self/ns/${name}`);
    const sentinel = join(config.consumer, "host-only-sentinel");
    await writeFile(sentinel, "synthetic host visibility probe\n");
    // Actual observed SDK arguments, with the terminal executable replaced only
    // for this capability probe. The real engine is used by every SDK operation.
    const source = `
import errno, json, os, socket
parent = ${JSON.stringify(namespaces)}
namespaces = {name: os.readlink('/proc/self/ns/' + name) for name in parent}
assert all(namespaces[name] != parent[name] for name in parent)
assert os.readlink('/proc/1/ns/pid') == namespaces['pid']
assert any(' - proc proc ' in line for line in open('/proc/self/mountinfo'))
assert not os.path.exists(${JSON.stringify(sentinel)})
assert not os.path.exists('/etc/passwd')
assert {line.split(':')[0].strip() for line in open('/proc/net/dev') if ':' in line} <= {'lo'}
assert len(open('/proc/net/route').read().splitlines()) == 1
blocked = []
for name, host, port, kind in [('localhost', '127.0.0.1', ${port}, socket.SOCK_STREAM), ('internet', '1.1.1.1', 443, socket.SOCK_STREAM), ('dns-udp', '8.8.8.8', 53, socket.SOCK_DGRAM)]:
    with socket.socket(socket.AF_INET, kind) as connection:
        connection.settimeout(2)
        try:
            connection.connect((host, port))
            if kind == socket.SOCK_DGRAM: connection.send(b'\\0')
        except OSError as error:
            assert error.errno in [errno.ENETUNREACH, errno.EHOSTUNREACH, errno.ECONNREFUSED, errno.EPERM, errno.EACCES]
            blocked.append({'target': name, 'errno': error.errno})
        else: raise AssertionError('sandbox egress succeeded')
try:
    open('/models/ocr_rec_v6_dict.txt', 'r+b')
except OSError as error:
    assert error.errno in [errno.EROFS, errno.EACCES, errno.EPERM]
else: raise AssertionError('model mount writable')
print(json.dumps({'privateNamespaces': sorted(namespaces), 'privateProcfs': True, 'hostSentinelHidden': True, 'modelsReadOnly': True, 'blocked': blocked}))
`;
    // checkRuntime removes its temporary work directory before returning. Keep
    // the observed /work mount policy, rebinding its source to fresh owned space.
    const refreshed = refreshSandboxWork(sandboxArgs, probeWork);
    const probeBoundary = refreshed.slice(0, refreshed.lastIndexOf("--"));
    const probeArgs = [
      ...probeBoundary,
      "--ro-bind",
      await realpath("/usr/bin/python3"),
      "/runtime/probe-python",
      "--",
      "/runtime/probe-python",
      "-I",
      "-c",
      source,
    ];
    const stdout = await command("/usr/bin/bwrap", probeArgs, {
      cwd: config.consumer,
      env: {},
      timeoutMs: 15_000,
      receipt: join(config.output, "isolation-process.json"),
    });
    const result = JSON.parse(stdout);
    ensure(result.blocked.length === 3 && result.privateProcfs === true, "isolation-probe-result");
    await json(join(config.output, "isolation.json"), {
      ...result,
      baselineLocalhostConnected: true,
      baselineInternetConnected: true,
      boundary:
        "observed SDK Bubblewrap boundary; Python probe executable substituted and private work directory refreshed",
    });
  } finally {
    await new Promise((done) => listener.close(done));
    await rm(probeWork, { recursive: true, force: true });
  }
}

async function consumer(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const { output, consumer: directory, summary } = config;
  const home = join(directory, "home");
  const env = cleanEnvironment(home);
  const fixtures = join(output, "fixtures");
  const runtimeDirectory = join(directory, "native-runtime");
  const launches = [];
  const modelLaunches = new Map();
  let importGuard = true;
  let sideEffects = 0;
  let sdkFetchCalls = 0;
  const originals = new Map();
  const originalFetch = globalThis.fetch;
  // This guard rejects import-time work; it never returns fabricated results.
  for (const name of [
    "spawn",
    "exec",
    "execFile",
    "fork",
    "spawnSync",
    "execSync",
    "execFileSync",
  ]) {
    originals.set(name, childProcess[name]);
    childProcess[name] = function (...args) {
      if (importGuard) {
        sideEffects++;
        throw new Error("import-process-side-effect");
      }
      const child = originals.get(name).apply(this, args);
      if (name === "spawn" && args[0] === "/usr/bin/bwrap") {
        launches.push({
          pid: child.pid,
          args: [...args[1]],
          conversion: args[1].includes("/work/input/source.pdf"),
        });
      }
      return child;
    };
  }
  globalThis.fetch = (...args) => {
    if (importGuard) {
      sideEffects++;
      throw new Error("import-network-side-effect");
    }
    sdkFetchCalls++;
    return originalFetch(...args);
  };
  syncBuiltinESMExports();
  const ledger = join(output, "cases.jsonl");
  async function test(name, operation) {
    const started = Date.now();
    try {
      const details = await operation();
      const receipt = { name, status: "passed", elapsedMs: Date.now() - started, ...details };
      summary.cases.push(receipt);
      await writeFile(ledger, `${JSON.stringify(receipt)}\n`, { flag: "a", mode: 0o600 });
      await json(join(output, "summary.json"), summary);
    } catch (error) {
      const receipt = {
        name,
        status: "failed",
        elapsedMs: Date.now() - started,
        ...failureEvidence(error),
      };
      summary.cases.push(receipt);
      await writeFile(ledger, `${JSON.stringify(receipt)}\n`, { flag: "a", mode: 0o600 });
      throw error;
    }
  }
  let native;
  let client;
  let manifest;
  let diagramBytes;
  const outputRoot = (name) => join(directory, "outputs", name);
  const input = (name) => join(fixtures, name);
  async function emptyOutput(name) {
    const path = outputRoot(name);
    ensure(
      !(await exists(path)) || (await readdir(path)).length === 0,
      "failed-operation-left-files"
    );
  }
  async function expectError(operation, code) {
    try {
      await operation();
    } catch (error) {
      ensure(error instanceof native.NativeError && error.code === code, `expected-native-${code}`);
      return { nativeError: code };
    }
    ensure(false, `expected-native-${code}`);
  }
  async function validateResult(
    result,
    name,
    {
      pages,
      markers = [],
      pageMarkers = {},
      table = false,
      asset = false,
      exactAsset = false,
      status = "success",
    },
    caseName
  ) {
    ensure(result.status === status, "conversion-status");
    ensure(
      result.runtime.isolation === "bubblewrap" && result.runtime.profile === manifest.id,
      "runtime-identity"
    );
    ensure(
      result.runtime.executableSha256 === manifest.executable.sha256,
      "runtime-executable-hash"
    );
    ensure(result.runtime.manifestSha256 === summary.manifestSha256, "runtime-manifest-hash");
    ensure(result.input.sha256 === sha256(await readFile(input(name))), "sdk-input-digest");
    ensure(result.input.filename === basename(name), "sdk-input-filename");
    const inventory = new Map();
    ensure(result.outputDirectory && result.files.length >= 2, "published-formats");
    for (const file of result.files) {
      ensure(!file.path.startsWith("/") && !file.path.split(/[\\/]/).includes(".."), "output-path");
      const path = join(result.outputDirectory, file.path);
      ensure(
        (await realpath(path)).startsWith(`${result.outputDirectory}${sep}`),
        "output-ownership"
      );
      const bytes = await readFile(path);
      ensure(bytes.length === file.size && sha256(bytes) === file.sha256, "output-file-digest");
      inventory.set(file.path, { ...file, bytes });
    }
    const jsonFile = [...inventory.values()].find((file) => file.kind === "json");
    const mdFile = [...inventory.values()].find((file) => file.kind === "md");
    ensure(jsonFile && mdFile && result.document, "json-and-markdown-required");
    const document = JSON.parse(jsonFile.bytes.toString("utf8"));
    ensure(
      JSON.stringify(document) === JSON.stringify(result.document),
      "returned-document-matches-file"
    );
    const schemaReceipt = JSON.parse(
      await command(
        config.python,
        [config.fixtureScript, "--check-document", join(result.outputDirectory, jsonFile.path)],
        { cwd: directory, env, timeoutMs: 30_000 }
      )
    );
    const markdown = mdFile.bytes.toString("utf8");
    validateFixtureContent(document, markdown, { markers, pageMarkers, table });
    const actualPages = Object.keys(document.pages)
      .map(Number)
      .sort((a, b) => a - b);
    ensure(
      JSON.stringify(actualPages) === JSON.stringify(result.coverage.completed),
      "sdk-coverage-matches-json-pages"
    );
    if (pages) {
      ensure(
        JSON.stringify(result.coverage.completed) === JSON.stringify(pages),
        "completed-page-coverage"
      );
      ensure(
        JSON.stringify(
          Object.keys(document.pages)
            .map(Number)
            .sort((a, b) => a - b)
        ) === JSON.stringify(pages),
        "json-page-coverage"
      );
      if (status === "success") ensure(result.coverage.complete === true, "complete-page-coverage");
    }
    const assets = [...inventory.values()].filter((file) => file.kind === "asset");
    if (asset)
      ensure(assets.length > 0 && document.pictures.length > 0, "real-image-assets-required");
    const referenced = new Set();
    for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = decodeURIComponent(match[1]);
      ensure(inventory.get(target)?.kind === "asset", "owned-markdown-image-reference");
      referenced.add(target);
    }
    for (const file of assets) {
      ensure(referenced.has(file.path), "asset-referenced-by-markdown");
      ensure(
        file.bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
        "asset-png-signature"
      );
      // The validation fixture schema requires embedded PNGs; decode the exported
      // asset too, using Pillow, without adding a hand-written image parser.
      await command(
        config.python,
        [
          "-I",
          "-c",
          "from PIL import Image; import sys\nwith Image.open(sys.argv[1]) as image:\n image.load()\n",
          join(result.outputDirectory, file.path),
        ],
        { cwd: directory, env, timeoutMs: 10_000 }
      );
    }
    if (exactAsset) {
      const originalHash = sha256(diagramBytes);
      ensure(
        assets.some((file) => file.sha256 === originalHash),
        "office-image-bytes-preserved"
      );
      ensure(
        document.pictures.some(
          (picture) =>
            sha256(Buffer.from(picture.image.uri.split(",")[1], "base64")) === originalHash
        ),
        "office-embedded-image-bytes-preserved"
      );
    }
    ensure(
      !(await readdir(outputRoot(caseName))).some((name) =>
        name.startsWith(".docling-native-stage-")
      ),
      "staging-cleanup"
    );
    return {
      status: result.status,
      inputSha256: result.input.sha256,
      coverage: result.coverage,
      files: result.files,
      warnings: result.warnings.length,
      jsonContract: schemaReceipt,
    };
  }
  async function convert(name, caseName, expectations, options = {}) {
    const launchIndex = launches.length;
    const result = await client.convertFile(input(name), {
      outputDirectory: outputRoot(caseName),
      timeoutMs: 90_000,
      ...options,
    });
    const details = await validateResult(result, name, expectations, caseName);
    const sandboxArgs = launches.slice(launchIndex).find((launch) => launch.conversion)?.args;
    return { result, details, sandboxArgs };
  }
  async function modelExecutionProbe(name, expectations) {
    const work = await mkdtemp(join(directory, "model-execution-"));
    try {
      await mkdir(join(work, "input"), { mode: 0o700 });
      await mkdir(join(work, "output"), { mode: 0o700 });
      const source = join(work, "input/source.pdf");
      await copyFile(input(name), source);
      const inputSha256 = sha256(await readFile(source));
      ensure(inputSha256 === sha256(await readFile(input(name))), "model-execution-input-copy");
      // Reuse a successful, unrestricted SDK PDF conversion verbatim, including
      // executable/models/fonts, procfs and every isolation/CLI option. Only the
      // owned /work source changes; debug/timing are explicit probe-only env.
      const args = refreshSandboxWork(modelLaunches.get(name), work);
      ensure(args.at(-1) === "/work/input/source.pdf", "model-execution-sdk-pdf-launch");
      args.splice(args.lastIndexOf("--"), 0,
        "--setenv", "DOCLING_RS_DEBUG", "1", "--setenv", "DOCLING_RS_TIMING", "1");
      const label = `model-execution-${name.replace(".", "-")}`;
      const result = await command("/usr/bin/bwrap", args, {
        cwd: work,
        env: {},
        timeoutMs: 90_000,
        receipt: join(output, `${label}-process.json`),
        diagnostics: true,
      });
      const stages = modelExecutionEvidence(
        Buffer.concat([result.stderr, result.stdout]).toString("utf8"), MODEL_STAGES[name]
      );
      const documentPath = join(work, "output/source.json");
      const jsonContract = JSON.parse(await command(
        config.python, [config.fixtureScript, "--check-document", documentPath],
        { cwd: directory, env, timeoutMs: 30_000 }
      ));
      const documentBytes = await readFile(documentPath);
      const markdownBytes = await readFile(join(work, "output/source.md"));
      const document = JSON.parse(documentBytes.toString("utf8"));
      validateFixtureContent(document, markdownBytes.toString("utf8"), expectations);
      const tableformerStructure = name === "original.pdf" ? tableFormerStructureEvidence(document) : undefined;
      ensure(
        JSON.stringify(Object.keys(document.pages).map(Number).sort((a, b) => a - b)) ===
          JSON.stringify(expectations.pages),
        "model-execution-page-coverage"
      );
      ensure(sha256(await readFile(source)) === inputSha256, "model-execution-input-unchanged");
      return {
        stages, inputSha256, jsonContract,
        ...(tableformerStructure ? { tableformerStructure } : {}),
        json: { bytes: documentBytes.length, sha256: sha256(documentBytes) },
        markdown: { bytes: markdownBytes.length, sha256: sha256(markdownBytes) },
        processReceipt: `${label}-process.json`,
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  try {
    await test("packed-import-before-installation", async () => {
      const before = await readdir(home);
      const root = await import("docling-sdk");
      const browser = await import("docling-sdk/browser");
      native = await import("docling-sdk/native");
      importGuard = false;
      ensure(
        sideEffects === 0 && !(await exists(runtimeDirectory)),
        "startup-does-not-install-or-launch"
      );
      ensure(
        JSON.stringify(before) === JSON.stringify(await readdir(home)),
        "startup-home-unchanged"
      );
      ensure(
        !("createNativeClient" in root) && !("createNativeClient" in browser),
        "native-entry-separation"
      );
      ensure(typeof native.createNativeClient === "function", "native-export");
      manifest = native.nativeRuntimeManifest;
      summary.profile = manifest.id;
      summary.manifestSha256 = sha256(JSON.stringify(manifest));
      await json(join(output, "profile.json"), manifest);
      return { importProcessOrFetchCalls: sideEffects, runtimeAbsentDuringImport: true };
    });
    await test("compatible-linux-system-abi", async () => {
      const release = await readFile("/etc/os-release", "utf8");
      const id = /^ID=(.*)$/m.exec(release)?.[1].replaceAll('"', "");
      const version = /^VERSION_ID=(.*)$/m.exec(release)?.[1].replaceAll('"', "");
      const glibc = process.report.getReport().header.glibcVersionRuntime;
      let libstd;
      for (const path of [
        "/usr/lib/x86_64-linux-gnu/libstdc++.so.6",
        "/usr/lib64/libstdc++.so.6",
        "/lib64/libstdc++.so.6",
      ]) {
        if (await exists(path)) {
          libstd = path;
          break;
        }
      }
      const hasRequiredLibstd =
        !!libstd && (await readFile(libstd)).includes(Buffer.from("GLIBCXX_3.4.32\0"));
      await json(join(output, "host-abi.json"), {
        id,
        version,
        glibc,
        requiredGlibc: manifest.minimumGlibc,
        libstdcppPath: libstd,
        hasGLIBCXX_3_4_32: hasRequiredLibstd,
        isolationHost: {
          userNamespacePolicy: await readFile("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").then((value) => value.trim(), () => "not-present"),
          processSecurityProfile: await readFile("/proc/self/attr/current", "utf8").then((value) => value.trim(), () => "not-present"),
          bubblewrapAppArmorProfilePresent: await exists("/etc/apparmor.d/bwrap") || await exists("/etc/apparmor.d/docling-native-ci-bwrap"),
        },
      });
      const numeric = (value) => Number(value.split(".")[0]) * 1000 + Number(value.split(".")[1]);
      ensure(
        glibc && numeric(glibc) >= numeric(manifest.minimumGlibc) && hasRequiredLibstd,
        "compatible-system-glibc-and-libstdcpp-required"
      );
      return { id, version, glibc, hasGLIBCXX_3_4_32: true };
    });
    await test("prepare-reviewed-runtime-once", async () => {
      await command(
        process.execPath,
        [
          join(directory, "node_modules/docling-sdk/scripts/prepare-native-runtime.mjs"),
          runtimeDirectory,
        ],
        {
          cwd: directory,
          env,
          timeoutMs: 1_860_000,
          receipt: join(output, "prepare-process.json"),
        }
      );
      const receipt = JSON.parse(
        await readFile(join(runtimeDirectory, "install-receipt.json"), "utf8")
      );
      ensure(receipt.manifestSha256 === summary.manifestSha256, "setup-packed-manifest-match");
      client = native.createNativeClient({
        executable: join(runtimeDirectory, "docling-rs"),
        modelDirectory: join(runtimeDirectory, "models"),
        bubblewrapPath: "/usr/bin/bwrap",
      });
      return { profile: receipt.profile, manifestSha256: receipt.manifestSha256 };
    });
    await test("generate-deterministic-fixtures", async () => {
      const font = join(runtimeDirectory, "models/fonts/NotoSans-Regular.ttf");
      const details = JSON.parse(
        await command(config.python, [config.fixtureScript, "--output", fixtures, "--font", font], {
          cwd: directory,
          env,
          timeoutMs: 60_000,
          receipt: join(output, "fixtures-process.json"),
        })
      );
      // A second independent generation catches clock/path-dependent artifacts.
      const second = join(directory, "second-fixtures");
      await command(config.python, [config.fixtureScript, "--output", second, "--font", font], {
        cwd: directory,
        env,
        timeoutMs: 60_000,
      });
      ensure(
        (await readFile(join(fixtures, "fixtures.json"))).equals(
          await readFile(join(second, "fixtures.json"))
        ),
        "fixture-reproducibility"
      );
      diagramBytes = await readFile(input("original-diagram.png"));
      return { ...details, independentGenerationsIdentical: true };
    });
    await test("real-isolated-runtime-readiness", async () => {
      const identity = await client.checkRuntime({ timeoutMs: 30_000 });
      ensure(
        identity.manifestSha256 === summary.manifestSha256 && identity.isolation === "bubblewrap",
        "readiness-identity"
      );
      ensure(launches.length > 0, "actual-sdk-spawn-observed");
      return { runtime: identity };
    });
    await test("live-no-egress-and-private-procfs", async () => {
      await isolationProbe(config, launches.at(-1)?.args);
      return { receipt: "isolation.json" };
    });
    await test("missing-bubblewrap-fails-closed", async () => {
      const closed = native.createNativeClient({
        executable: join(runtimeDirectory, "docling-rs"),
        modelDirectory: join(runtimeDirectory, "models"),
        bubblewrapPath: join(directory, "absent-bwrap"),
      });
      const index = launches.length;
      const details = await expectError(
        () =>
          closed.convertFile(input("original.docx"), {
            outputDirectory: outputRoot("absent-bwrap"),
            timeoutMs: 30_000,
          }),
        "ISOLATION_UNAVAILABLE"
      );
      ensure(launches.length === index, "missing-isolation-launched-no-process");
      await emptyOutput("absent-bwrap");
      return details;
    });
    for (const [name, expectation] of [
      [
        "original.pdf",
        {
          pages: [1, 2],
          markers: ["PDF_ALPHA", "PDF_OMEGA"],
          pageMarkers: { 1: "PDF_ALPHA", 2: "PDF_OMEGA" },
          table: true,
          asset: true,
        },
      ],
      [
        "original.docx",
        { markers: ["DOCX_ALPHA", "DOCX_OMEGA"], table: true, asset: true, exactAsset: true },
      ],
      [
        "original.pptx",
        {
          pages: [1, 2],
          markers: ["PPTX_ALPHA", "PPTX_OMEGA", "PPTX_NOTES"],
          pageMarkers: { 1: "PPTX_ALPHA", 2: "PPTX_OMEGA" },
          table: true,
          asset: true,
          exactAsset: true,
        },
      ],
    ])
      await test(`real-${name}`, async () => {
        const { result, details, sandboxArgs } = await convert(name, `real-${name}`, expectation);
        if (name === "original.pdf") modelLaunches.set(name, sandboxArgs);
        if (name.endsWith("docx"))
          ensure(
            result.coverage.basis === "not-reported" && result.coverage.complete === undefined,
            "docx-does-not-invent-rendered-pages"
          );
        if (name.endsWith("pptx"))
          ensure(
            result.document.texts.some(
              (item) => item.content_layer === "notes" && item.text.includes("PPTX_NOTES")
            ),
            "speaker-note-content-layer"
          );
        return details;
      });
    await test("real-scanned-ocr", async () => {
      const { result, details, sandboxArgs } = await convert("scanned.pdf", "scan", { pages: [1] });
      modelLaunches.set("scanned.pdf", sandboxArgs);
      const text = result.document.texts.map((item) => item.text).join(" ");
      // Do not gate a known OCR spelling error as exact PDF/Python parity.
      ensure(
        /ALPHA/i.test(text) && /Apples\s*11/i.test(text) && /Pears\s*22/i.test(text),
        "ocr-content-required"
      );
      ensure(
        !/SCANNED ALPHA/.test((await readFile(input("scanned.pdf"))).toString("latin1")),
        "scan-has-no-digital-marker"
      );
      return details;
    });
    for (const [name, expectations] of [
      ["original.pdf", {
        pages: [1, 2], markers: ["PDF_ALPHA", "PDF_OMEGA"],
        pageMarkers: { 1: "PDF_ALPHA", 2: "PDF_OMEGA" }, table: true,
      }],
      ["scanned.pdf", { pages: [1], scan: true }],
    ])
      await test(`real-model-execution-${name}`, () => modelExecutionProbe(name, expectations));
    await test("real-pdf-page-range", async () => {
      const { result, details } = await convert(
        "original.pdf",
        "range",
        { pages: [2], markers: ["PDF_OMEGA"], pageMarkers: { 2: "PDF_OMEGA" } },
        { pageRange: [2, 2] }
      );
      ensure(
        !result.document.texts.some((item) => item.text.includes("PDF_ALPHA")),
        "page-range-excludes-page-one"
      );
      ensure(JSON.stringify(result.coverage.requested) === "[2,2]", "requested-range-receipt");
      return details;
    });
    await test("real-empty.docx", async () => {
      const name = "empty.docx";
      const result = await client.convertFile(input(name), {
        outputDirectory: outputRoot(name),
        timeoutMs: 30_000,
      });
      await validateResult(result, name, { status: "success" }, name);
      ensure(
        result.document.texts.length === 0 &&
          result.document.tables.length === 0 &&
          result.document.pictures.length === 0,
        "empty-office-stays-empty"
      );
      return { status: result.status, coverage: result.coverage, published: true };
    });
    await test("reject-zero-slide-pptx-before-launch", async () => {
      // A package with no slide list is outside the supported PPTX contract.
      // Its rejection must not be confused with an engine-conversion failure.
      const index = launches.length;
      const details = await expectError(
        () => client.convertFile(input("empty.pptx"), {
          outputDirectory: outputRoot("empty.pptx"),
          timeoutMs: 30_000,
        }),
        "INVALID_INPUT"
      );
      ensure(launches.length === index, "zero-slide-pptx-launched-no-process");
      await emptyOutput("empty.pptx");
      return { ...details, rejectedBeforeLaunch: true, published: false };
    });
    for (const name of ["corrupt.pdf", "corrupt.docx", "corrupt.pptx"])
      await test(`reject-${name}`, async () => {
        if (name.endsWith("pdf")) {
          const result = await client.convertFile(input(name), {
            outputDirectory: outputRoot(name),
            timeoutMs: 30_000,
          });
          ensure(
            result.status === "failure" && result.files.length === 0 && !result.outputDirectory,
            "corrupt-engine-failure"
          );
        } else
          await expectError(
            () =>
              client.convertFile(input(name), {
                outputDirectory: outputRoot(name),
                timeoutMs: 30_000,
              }),
            "INVALID_INPUT"
          );
        await emptyOutput(name);
        return { rejected: true, published: false };
      });
    await test("real-cooperative-document-budget", async () => {
      const { result, details } = await convert(
        "timeout.pdf",
        "partial",
        {
          status: "partial_success",
          markers: ["NATIVE_LONG_PAGE_0001"],
          pageMarkers: { 1: "NATIVE_LONG_PAGE_0001" },
        },
        { documentTimeoutSeconds: 1, timeoutMs: 30_000 }
      );
      ensure(
        result.coverage.expected === 256 && result.coverage.complete === false,
        "partial-coverage-not-complete"
      );
      ensure(
        result.coverage.completed.length > 0 &&
          result.coverage.completed.length < 256 &&
          result.warnings.length > 0,
        "partial-publishes-validated-subset"
      );
      ensure(
        result.coverage.completed.every((page, index) => page === index + 1),
        "partial-contiguous-page-prefix"
      );
      return details;
    });
    for (const kind of ["abort", "deadline"])
      await test(`real-${kind}-and-cleanup`, async () => {
        const index = launches.length;
        const controller = new AbortController();
        const started = Date.now();
        const operation = client.convertFile(input("timeout.pdf"), {
          outputDirectory: outputRoot(kind),
          timeoutMs: kind === "deadline" ? 6_000 : 20_000,
          signal: controller.signal,
        });
        // Attach a rejection handler immediately while waiting for engine startup.
        const settled = operation.then(
          (result) => ({ result }),
          (error) => ({ error })
        );
        let observed;
        try {
          observed = await waitFor(
            async () => {
              const launch = launches.slice(index).find((item) => item.conversion);
              if (!launch) return false;
              const tree = await descendants(launch.pid);
              return tree.some((info) => info.engine) && tree;
            },
            5_000,
            "real-conversion-engine-not-observed"
          );
          if (kind === "abort") controller.abort();
          const outcome = await settled;
          ensure(
            outcome.error instanceof native.NativeError &&
              outcome.error.code === (kind === "abort" ? "ABORTED" : "TIMEOUT"),
            "cancellation-error-code"
          );
          ensure(
            Date.now() - started <= (kind === "abort" ? 8_000 : 9_000),
            "cancellation-wall-clock-bound"
          );
          await gone(observed);
          await noRuntimeProcess(join(runtimeDirectory, "docling-rs"));
          await emptyOutput(kind);
          return {
            nativeError: outcome.error.code,
            realEngineObserved: true,
            observedProcesses: observed.length,
            descendantsGone: true,
            stagingEmpty: true,
          };
        } finally {
          controller.abort();
          await settled;
        }
      });
    await test("same-basename-concurrency", async () => {
      const target = outputRoot("concurrency");
      const [left, right] = await Promise.all([
        client.convertFile(input("left/same.docx"), {
          outputDirectory: target,
          formats: ["md"],
          timeoutMs: 30_000,
        }),
        client.convertFile(input("right/same.docx"), {
          outputDirectory: target,
          formats: ["json"],
          timeoutMs: 30_000,
        }),
      ]);
      ensure(
        left.status === "success" &&
          right.status === "success" &&
          left.outputDirectory !== right.outputDirectory,
        "concurrency-publication"
      );
      ensure(
        left.input.filename === "same.docx" &&
          right.input.filename === "same.docx" &&
          left.input.sha256 !== right.input.sha256,
        "concurrency-input-identity"
      );
      ensure(
        left.document === undefined && !left.files.some((file) => file.kind === "json"),
        "markdown-only-contract"
      );
      ensure(!right.files.some((file) => file.kind === "md"), "json-only-contract");
      const leftText = await readFile(
        join(left.outputDirectory, left.files.find((file) => file.kind === "md").path),
        "utf8"
      );
      const rightText = right.document.texts.map((item) => item.text).join(" ");
      ensure(
        leftText.includes("CONCURRENT_LEFT") && !leftText.includes("CONCURRENT_RIGHT"),
        "concurrency-left-content"
      );
      ensure(
        rightText.includes("CONCURRENT_RIGHT") && !rightText.includes("CONCURRENT_LEFT"),
        "concurrency-right-content"
      );
      ensure((await readdir(target)).length === 2, "concurrency-no-staging-residue");
      return {
        distinctPublishedDirectories: true,
        distinctSourceDigests: true,
        requestedFormatsPreserved: true,
      };
    });
    // The install was created privately for this consumer. Mutate only a small
    // reviewed model asset, restore in finally, and never duplicate/download models.
    const dictionary = join(runtimeDirectory, "models/ocr_rec_v6_dict.txt");
    for (const kind of ["missing", "corrupt"])
      await test(`fail-closed-${kind}-model`, async () => {
        const backup = join(runtimeDirectory, "dictionary-backup");
        const original = await readFile(dictionary);
        const index = launches.length;
        try {
          if (kind === "missing") await rename(dictionary, backup);
          else {
            const handle = await open(dictionary, "r+");
            try {
              await handle.write(Buffer.from([original[0] ^ 1]), 0, 1, 0);
            } finally {
              await handle.close();
            }
          }
          await expectError(
            () =>
              client.convertFile(input("scanned.pdf"), {
                outputDirectory: outputRoot(kind),
                timeoutMs: 30_000,
              }),
            kind === "missing" ? "RUNTIME_UNAVAILABLE" : "RUNTIME_INTEGRITY"
          );
          ensure(launches.length === index, "invalid-model-launched-no-process");
          await emptyOutput(kind);
        } finally {
          if (kind === "missing") await rename(backup, dictionary);
          else await writeFile(dictionary, original);
          ensure(sha256(await readFile(dictionary)) === sha256(original), "model-restored");
        }
        return {
          rejectedBeforeLaunch: true,
          restored: true,
          alteredBytes: kind === "missing" ? 0 : 1,
        };
      });
    await test("final-runtime-and-fixture-integrity", async () => {
      await client.checkRuntime({ timeoutMs: 30_000 });
      await noRuntimeProcess(join(runtimeDirectory, "docling-rs"));
      ensure(sdkFetchCalls === 0, "sdk-performed-no-fetch-downloads");
      const fixtureManifest = JSON.parse(await readFile(input("fixtures.json"), "utf8"));
      for (const [name, identity] of Object.entries(fixtureManifest.files)) {
        ensure(
          sha256(await readFile(input(name))) === identity.sha256,
          "fixture-changed-during-validation"
        );
      }
      return {
        allReviewedRuntimeFilesVerified: true,
        allFixtureDigestsUnchanged: true,
        sdkFetchCalls,
      };
    });
    summary.status = "passed";
  } catch (error) {
    summary.status = "failed";
    summary.failure = failureEvidence(error);
    throw error;
  } finally {
    importGuard = false;
    for (const [name, original] of originals) childProcess[name] = original;
    globalThis.fetch = originalFetch;
    syncBuiltinESMExports();
    await json(join(output, "summary.json"), summary);
  }
}

if (process.argv[2] === "--help") {
  process.stdout.write(
    "Usage: node scripts/validate-native-sdk.mjs --tarball <npm-pack.tgz> --python <pinned-venv/bin/python> --output <fresh-evidence-directory>\nLinux x64 Ubuntu 24.04; real Bubblewrap private namespaces/procfs required. Downloads the reviewed profile once into a disposable packed consumer.\n"
  );
} else {
  (process.argv[2] === "--consumer"
    ? consumer(process.argv[3])
    : parent(process.argv.slice(2))
  ).catch((error) => {
    process.stderr.write(`Native validation failed: ${error.validationLabel ?? safeCode(error)}\n`);
    process.exitCode = 1;
  });
}
