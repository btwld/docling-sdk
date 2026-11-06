import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe("pinned OpenAPI tooling", () => {
  it("reproduces the checked-in generated types and verifies provenance", async () => {
    const result = await exec(process.execPath, ["scripts/generate-openapi.mjs", "--check"], { timeout: 20_000 });
    expect(result.stdout).toContain("Pinned schema and generated types match");
  });

  it.each([
    [200, "<html>not a schema</html>", false],
    [200, JSON.stringify({ error: "not a schema" }), false],
    [503, JSON.stringify({ error: "unavailable" }), false],
    [200, JSON.stringify({ openapi: "3.1.0", info: { version: "different" }, paths: {} }), false],
    [200, JSON.stringify({ openapi: "3.1.0", info: { version: "1.7.2" }, paths: { "/health": {} } }), true],
  ] as const)("only replaces output with a valid pinned JSON schema (HTTP %s, accepted=%s)", async (status, body, accepted) => {
    const directory = await mkdtemp(join(tmpdir(), "docling-openapi-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const output = join(directory, "candidate.json");
    await writeFile(output, "preserve this file");
    const server = createServer((request, response) => {
      expect(request.url).toBe("/openapi.json");
      response.statusCode = status;
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    });
    const port = (server.address() as { port: number }).port;
    const call = exec(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/fetch-openapi.ts", "--url", `http://127.0.0.1:${port}`, "--output", output], { timeout: 20_000 });
    if (accepted) {
      await expect(call).resolves.toMatchObject({ stderr: "" });
      expect(JSON.parse(await readFile(output, "utf8")).paths).toHaveProperty("/health");
    } else {
      await expect(call).rejects.toBeDefined();
      expect(await readFile(output, "utf8")).toBe("preserve this file");
    }
  });
});
