import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function runCoverageFixture(includeUncoveredFunction: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "docling-coverage-gate-"));
  try {
    await symlink(join(projectRoot, "node_modules"), join(directory, "node_modules"), "junction");
    await mkdir(join(directory, "src"));
    await mkdir(join(directory, "tests/unit"), { recursive: true });
    await writeFile(
      join(directory, "src/subject.ts"),
      `export function covered() {
  return 1;
}
${
  includeUncoveredFunction
    ? `export function uncovered() {
  const a = 2;
  const b = 3;
  const c = 4;
  const d = 5;
  return a + b + c + d;
}
`
    : ""
}`
    );
    await writeFile(
      join(directory, "tests/unit/probe.test.ts"),
      'import { covered } from "../../src/subject";\nit("runs a covered function", () => { expect(covered()).toBe(1); });\n'
    );
    const configFile = join(directory, "fixture.config.mjs");
    await writeFile(
      configFile,
      `import base from ${JSON.stringify(join(projectRoot, "vitest.config.ts"))};
export default {
  ...base,
  root: ${JSON.stringify(directory)},
  test: {
    ...base.test,
    setupFiles: [],
    maxWorkers: 1,
    coverage: { ...base.test.coverage, reporter: ["json-summary"], reportsDirectory: "coverage" }
  }
};
`
    );
    let exitCode = 0;
    let output = "";
    try {
      const result = await execute(
        process.execPath,
        [
          join(projectRoot, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          configFile,
          "--coverage",
        ],
        { cwd: projectRoot, timeout: 20000, maxBuffer: 2 * 1024 * 1024 }
      );
      output = result.stdout + result.stderr;
    } catch (error) {
      const failure = error as Error & { code?: number | string; stdout?: string; stderr?: string };
      if (typeof failure.code !== "number") throw error;
      exitCode = failure.code;
      output = (failure.stdout ?? "") + (failure.stderr ?? "");
    }
    const report = await readFile(join(directory, "coverage/coverage-summary.json"), "utf8").catch(
      (error) => {
        throw new Error(`Coverage fixture did not produce its report:\n${output}`, {
          cause: error,
        });
      }
    );
    const coverage = JSON.parse(report);
    return { exitCode, output, coverage };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("production coverage gate", () => {
  it("rejects an undercovered production source using the repository configuration", async () => {
    const result = await runCoverageFixture(true);
    expect(result.exitCode, result.output).toBe(1);
    expect(result.coverage.total.lines.pct).toBeLessThan(80);
    expect(result.coverage.total.functions.pct).toBeLessThan(80);
    expect(result.output).toMatch(/does not meet.*threshold/);
  });

  it("accepts a fully covered production source using the same gate", async () => {
    const result = await runCoverageFixture(false);
    expect(result.exitCode, result.output).toBe(0);
    for (const metric of ["lines", "branches", "functions", "statements"]) {
      expect(result.coverage.total[metric].pct).toBe(100);
    }
  });
});
