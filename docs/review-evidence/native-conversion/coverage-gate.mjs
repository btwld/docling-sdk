/**
 * Disposable reproduction of R7 using the installed Vitest, without changing
 * vitest.config.ts or the product tests. Exit zero means the gate defect and
 * the expected failure of a correctly configured gate were both reproduced.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const evidenceRoot = resolve(".context/native-review");
await mkdir(evidenceRoot, { recursive: true });
const root = await mkdtemp(join(evidenceRoot, "coverage-gate-"));
await writeFile(join(root, "subject.ts"), `export function covered() {
  return 1;
}
export function uncovered() {
  const a = 2;
  const b = 3;
  const c = 4;
  const d = 5;
  return a + b + c + d;
}
`);
await writeFile(join(root, "probe.test.ts"), `import { it, expect } from "vitest";
import { covered } from "./subject";
it("covers only one function", () => { expect(covered()).toBe(1); });
`);
const observations = [];
for (const mode of ["nested-global", "direct"]) {
  const target = { lines: 80, branches: 80, functions: 80, statements: 80 };
  const config = {
    test: {
      include: ["probe.test.ts"],
      environment: "node",
      coverage: {
        provider: "v8", include: ["subject.ts"], reporter: ["json-summary"],
        reportsDirectory: `coverage-${mode}`,
        thresholds: mode === "nested-global" ? { global: target } : target,
      },
    },
  };
  const configPath = join(root, `${mode}.config.mjs`);
  await writeFile(configPath, `export default ${JSON.stringify(config, null, 2)};\n`);
  const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--root", root, "--config", configPath, "--coverage"], { encoding: "utf8", timeout: 60000 });
  assert.ifError(result.error);
  const log = result.stdout + result.stderr;
  await writeFile(join(root, `${mode}.log`), log);
  const coverage = JSON.parse(await readFile(join(root, `coverage-${mode}`, "coverage-summary.json"), "utf8"));
  assert(coverage.total.lines.pct < 80);
  assert.equal(result.status, mode === "nested-global" ? 0 : 1, log);
  if (mode === "direct") assert.match(log, /does not meet.*threshold/);
  observations.push({ mode, exitCode: result.status, lines: coverage.total.lines.pct, functions: coverage.total.functions.pct });
}
const summary = {
  recordedAt: new Date().toISOString(),
  node: process.version,
  vitest: JSON.parse(await readFile("node_modules/vitest/package.json", "utf8")).version,
  fixtureDirectory: relative(process.cwd(), root),
  observations,
  interpretation: "The nested gate accepted low coverage; direct thresholds rejected the identical fixture.",
};
await writeFile(join(evidenceRoot, "coverage-gate-results.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
