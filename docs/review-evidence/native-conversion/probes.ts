/**
 * Review evidence for the unchanged 5ae3517 baseline, not a regression suite.
 * Run from the repository root: node_modules/.bin/tsx docs/review-evidence/native-conversion/probes.ts
 * Passing assertions mean the documented defects were reproduced.
 * Only synthetic files, local stub processes, and a loopback HTTP server are used.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Docling } from "../../../src/docling.ts";
import { CliUtils } from "../../../src/cli/utils.ts";
import { HttpClient } from "../../../src/api/http.ts";
import { AsyncTaskManager } from "../../../src/services/async-task-manager.ts";

assert.equal(process.platform, "linux", "This evidence script was designed for the Linux cloud workspace");
const evidenceRoot = resolve(".context/native-review");
await mkdir(evidenceRoot, { recursive: true });
const runRoot = await mkdtemp(join(evidenceRoot, "probe-run-"));
const observations: Array<{ id: string; reproduced: boolean; observed: unknown }> = [];

type Behavior = "write" | "fail" | "empty" | "mixed";
async function fixture(name: string, behavior: Behavior, filename = "synthetic.pdf") {
  const directory = join(runRoot, name);
  const outputDir = join(directory, "outputs");
  await mkdir(outputDir, { recursive: true });
  const input = join(directory, filename);
  await writeFile(input, "%PDF-1.4\nSYNTHETIC REVIEW FIXTURE; not a real conversion document\n");
  const invocationLog = join(directory, "invocations.jsonl");
  const executable = join(directory, "converter.mjs");
  const source = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("SYNTHETIC converter; no document engine");
  process.exit(0);
}
appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify(args) + "\\n");
const behavior = ${JSON.stringify(behavior)};
const format = args[args.indexOf("--to") + 1];
if (behavior === "fail" || (behavior === "mixed" && format === "json")) process.exit(7);
if (behavior === "empty") process.exit(0);
const output = args[args.indexOf("--output") + 1];
const stem = basename(args[0], extname(args[0]));
writeFileSync(join(output, stem + "." + format), "SYNTHETIC NEW DOCUMENT\\n");
`;
  await writeFile(executable, source);
  await chmod(executable, 0o700);
  const client = new Docling({ cli: { doclingPath: executable, outputDir, timeout: 2000 } });
  return {
    client, input, filename, outputDir,
    invocations: async () => (await readFile(invocationLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line)),
  };
}

function record(id: string, observed: unknown) {
  observations.push({ id, reproduced: true, observed });
  console.log(JSON.stringify({ id, reproduced: true, observed }));
}

// R1: create the literal filename without a shell; only the SDK invokes a shell.
{
  const f = await fixture("r1", "write", "$(printf DOCLING_REVIEW_LITERAL).pdf");
  try {
    await f.client.convert(f.input, f.filename, { to_formats: ["md"] });
    const calls = await f.invocations();
    assert.equal(calls.length, 1);
    assert.equal(basename(calls[0][0]), "DOCLING_REVIEW_LITERAL.pdf");
    assert.notEqual(calls[0][0], f.input);
    record("R1", { literalFilename: f.filename, converterReceived: basename(calls[0][0]) });
  } finally { f.client.destroy(); }
}

// R2: each case enters through the public factory and convert method.
{
  const cases: unknown[] = [];
  for (const behavior of ["fail", "empty", "mixed"] as const) {
    const f = await fixture(`r2-${behavior}`, behavior);
    const partialEvents: unknown[] = [];
    f.client.progress.on("conversion-partial-failure", (event) => partialEvents.push(event));
    try {
      const result = await f.client.convert(f.input, f.filename, {
        to_formats: behavior === "mixed" ? ["md", "json"] : ["md"],
      });
      assert.equal(result.status, "success");
      if (behavior !== "mixed") assert.equal(result.document.md_content, undefined);
      else {
        assert.equal(result.document.md_content, "SYNTHETIC NEW DOCUMENT\n");
        assert.equal(result.document.json_content, undefined);
      }
      assert.equal(partialEvents.length, behavior === "empty" ? 0 : 1);
      cases.push({ behavior, status: result.status, documentKeys: Object.keys(result.document), partialFailureEvents: partialEvents.length, converterCalls: (await f.invocations()).length });
    } finally { f.client.destroy(); }
  }
  record("R2", cases);
}

// R3: this stub exits zero and never writes a result for the new input.
{
  const f = await fixture("r3", "empty", "new-document.pdf");
  try {
    const stale = "SYNTHETIC OUTPUT BELONGING TO ANOTHER DOCUMENT\n";
    await writeFile(join(f.outputDir, "output.md"), stale);
    const result = await f.client.convert(f.input, f.filename, { to_formats: ["md"] });
    assert.equal(result.document.md_content, stale);
    record("R3", { newInput: f.filename, status: result.status, returnedOtherDocument: result.document.md_content === stale });
  } finally { f.client.destroy(); }
}

// R4: register tasks through public methods; emit local task events before polling starts.
{
  const http = new HttpClient({ baseUrl: "http://127.0.0.1:1", retries: 0 });
  const manager = new AsyncTaskManager(http);
  try {
    manager.startPollingExistingTask("A", { timeout: 2000 });
    manager.startPollingExistingTask("B", { timeout: 2000 });
    const waitA = manager.waitForCompletion("A");
    const waitB = manager.waitForCompletion("B");
    manager.emit("success", { taskId: "A" });
    manager.emit("success", { taskId: "B" });
    assert.equal((await waitA).success, true);
    const bPending = await Promise.race([waitB.then(() => false), delay(50).then(() => true)]);
    assert.equal(bPending, true);
    const listeners = Object.fromEntries(["success", "failure", "timeout", "error"].map((name) => [name, manager.listenerCount(name)]));
    record("R4", { aCompleted: true, bPendingAfterItsSuccessEvent: bPending, remainingListeners: listeners });
    // Settle the orphaned waiter and remove timers without waiting for an SDK timeout.
    manager.emit("timeout", { taskId: "B" });
    await waitB;
  } finally { manager.destroy(); http.destroy(); }
}

// R5a: both executable candidates are nonexistent; no Python installation is invoked.
{
  const missing = join(runRoot, "nonexistent-executable");
  const client = new Docling({ cli: { doclingPath: missing, pythonPath: missing } });
  let ready = false;
  client.progress.on("initialized", (event) => { ready = event.status === "ready"; });
  try {
    const available = await client.checkAvailability();
    await client.initialize();
    assert.equal(available, false);
    assert.equal(ready, true);
    record("R5-readiness", { available, initializeResolved: true, emittedReady: ready });
  } finally { client.destroy(); }
}

// R5b: only the child process sends SIGTERM to itself.
{
  const args = ["-e", 'process.kill(process.pid, "SIGTERM")'];
  const control = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 2000 });
  assert.equal(control.status, null);
  assert.equal(control.signal, "SIGTERM");
  const result = await new CliUtils({ doclingPath: process.execPath, timeout: 2000 }).execute(args);
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  record("R5-signal", { control: { exitCode: control.status, signal: control.signal }, sdk: { success: result.success, exitCode: result.exitCode } });
}

// R6: real HTTP calls confined to loopback verify both public configuration paths.
{
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end('{"error":"synthetic retry fixture"}');
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const direct = new HttpClient({ baseUrl, retries: 0 });
  const client = new Docling({ api: { baseUrl, retries: 0 } });
  const updated = new Docling({ api: { baseUrl, retries: 1 } });
  try {
    assert.equal(direct.getConfig().retries, 3);
    await assert.rejects(() => client.health());
    assert.equal(requests, 4);
    requests = 0;
    updated.updateConfig({ retries: 0 });
    await assert.rejects(() => updated.health());
    assert.equal(requests, 2);
    record("R6", { requestedRetries: 0, directConfiguredRetries: direct.getConfig().retries, constructorHttpAttempts: 4, updateFromOneToZeroHttpAttempts: requests });
  } finally {
    client.destroy(); updated.destroy(); direct.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

const summary = {
  recordedAt: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  fixtureDirectory: relative(process.cwd(), runRoot),
  interpretation: "All seven probes reproduced baseline defects; this is not a correctness pass or native-engine test.",
  observations,
};
await writeFile(join(evidenceRoot, "probe-results.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`Evidence saved to ${relative(process.cwd(), join(evidenceRoot, "probe-results.json"))}`);
