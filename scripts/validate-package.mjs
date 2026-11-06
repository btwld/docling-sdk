/** Install the packed artifact into clean consumers, including no optional deps. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const exec = promisify(execFile);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check through npm run validate:package");
const root = fileURLToPath(new URL("..", import.meta.url));
const packageName = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).name;
const directory = await mkdtemp(join(tmpdir(), "docling-package-"));
async function runNpm(args, cwd) {
  return exec(process.execPath, [npmCli, ...args], { cwd, maxBuffer: 4 * 1024 * 1024 });
}
const packed = JSON.parse((await runNpm(["pack", "--ignore-scripts", "--json", "--pack-destination", directory], root)).stdout)[0];
const tarball = join(directory, packed.filename);
const requests = [];
const browserResources = new Map();
const server = createServer((request, response) => {
  requests.push({ url: request.url, key: request.headers["x-api-key"] });
  request.resume();
  request.on("end", () => {
    const resource = browserResources.get(request.url);
    if (resource) {
      response.setHeader("content-type", resource.type);
      response.end(resource.body);
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.url === "/health" ? { status: "ok" } : {
      document: { filename: "fixture.pdf", md_content: "packed consumer output" },
      status: "success", processing_time: 0,
    }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
try {
  for (const omitOptional of [false, true]) {
    const consumer = await mkdtemp(join(directory, omitOptional ? "minimal-" : "full-"));
    await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "docling-packed-consumer", private: true, type: "module" }));
    await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", ...(omitOptional ? ["--omit=optional"] : []), tarball], consumer);
    const check = `
import assert from "node:assert/strict";
import { createAPIClient, createCLIClient } from ${JSON.stringify(packageName)};
import * as cli from ${JSON.stringify(`${packageName}/cli`)};
import * as browser from ${JSON.stringify(`${packageName}/browser`)};
import * as web from ${JSON.stringify(`${packageName}/web`)};
import * as platform from ${JSON.stringify(`${packageName}/platform`)};
assert.equal(typeof cli.CliUtils, "function");
assert.equal(typeof web.createWebClient, "function");
assert.equal(typeof platform.createAPIClient, "function");
assert.equal("DoclingCLIClient" in browser, false);
assert.equal(typeof createCLIClient({ doclingPath: "missing-docling-package-probe" }).convert, "function");
const runner = new cli.CliUtils({ doclingPath: process.execPath });
const literal = "literal $(printf NO_EXPANSION) & spaces";
const processResult = await runner.execute(["-e", "process.stdout.write(process.argv[1])", literal], { timeout: 5000 });
assert.equal(processResult.success, true);
assert.equal(processResult.stdout, literal);
const failedProcess = await runner.execute(["-e", "process.exit(7)"], { timeout: 5000 });
assert.equal(failedProcess.success, false);
assert.equal(failedProcess.exitCode, 7);
const client = createAPIClient(${JSON.stringify(baseUrl)}, { retries: 0, apiKey: "packed-key" });
assert.equal((await client.health()).status, "ok");
assert.equal((await client.convert(new Uint8Array([1, 2, 3]), "fixture.pdf", { to_formats: ["md"] })).document.md_content, "packed consumer output");
client.destroy();
const browserClient = browser.createAPIClient(${JSON.stringify(baseUrl)}, { retries: 0 });
assert.equal((await browserClient.health()).status, "ok");
browserClient.destroy();
console.log("Packed imports, subprocess execution and real HTTP calls passed");
`;
    await writeFile(join(consumer, "check.mjs"), check);
    const result = await exec(process.execPath, ["check.mjs"], { cwd: consumer });
    const browserSource = join(consumer, "browser.js");
    await writeFile(browserSource, `import { createAPIClient } from ${JSON.stringify(packageName)}; import { createWebClient } from ${JSON.stringify(`${packageName}/web`)}; globalThis.doclingSmoke = { createAPIClient, createWebClient };`);
    const bundle = await build({ entryPoints: [browserSource], bundle: true, platform: "browser", format: "esm", write: false, metafile: true, external: ["@huggingface/transformers", "onnxruntime-web", "unpdf"] });
    const inputs = Object.keys(bundle.metafile.inputs);
    assert(!inputs.some((path) => /(?:process-runner|cli-client|node_modules\/(?:fflate|archiver|ws)\/)/.test(path)), "Browser bundle pulled in a Node-only implementation");
    if (process.env.DOCLING_TEST_CHROME && !omitOptional) {
      browserResources.set("/browser.js", { type: "text/javascript", body: bundle.outputFiles[0].text });
      browserResources.set("/browser.html", { type: "text/html", body: `<!doctype html><body>pending<script type="module">
import "/browser.js";
try {
  const client = globalThis.doclingSmoke.createAPIClient(location.origin, { retries: 0, apiKey: "browser-key" });
  const health = await client.health();
  const file = new File(["fixture"], "browser.pdf", { type: "application/pdf" });
  const converted = await client.convert(new Uint8Array(await file.arrayBuffer()), file.name, { to_formats: ["md"] });
  if (health.status !== "ok" || converted.document.md_content !== "packed consumer output") throw new Error("Unexpected browser response");
  client.destroy();
  document.body.textContent = "DOCLING_BROWSER_PASS";
} catch (error) { document.body.textContent = "DOCLING_BROWSER_FAIL: " + error.message; }
</script>` });
      const profile = await mkdtemp(join(directory, "chrome-"));
      const browser = await exec(process.env.DOCLING_TEST_CHROME, ["--headless", "--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`, "--virtual-time-budget=10000", "--dump-dom", `${baseUrl}/browser.html`], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      assert.match(browser.stdout, /<body>DOCLING_BROWSER_PASS<\/body>/, browser.stdout);
      assert(requests.some((request) => request.key === "browser-key"));
      console.log("Headless Chrome packed API: real File, multipart upload, fetch and response passed (no OCR/model inference)");
    }
    const artifacts = await readFile(join(consumer, "node_modules", packageName, "package.json"), "utf8");
    assert.equal(JSON.parse(artifacts).name, packageName);
    console.log(`${omitOptional ? "No optional dependencies" : "Full dependencies"}: ${result.stdout.trim()}, browser bundling passed`);
    await runNpm(["install", "--save-dev", "--ignore-scripts", "--no-audit", "--no-fund", ...(omitOptional ? ["--omit=optional"] : []), "typescript@5.5.4", "@types/node@18"], consumer);
    await writeFile(join(consumer, "types.ts"), `
import { createAPIClient, createCLIClient } from ${JSON.stringify(packageName)};
import type { OpenAPI, ConversionOptions } from ${JSON.stringify(packageName)};
import { createAPIClient as browserAPI } from ${JSON.stringify(`${packageName}/browser`)};
type ConvertEndpoint = OpenAPI.paths["/v1/convert/source"]["post"];
type TaskStatus = OpenAPI.components["schemas"]["TaskStatusResponse"];
// @ts-expect-error Unknown endpoints must not become any.
type Missing = OpenAPI.paths["/does-not-exist"];
const options: ConversionOptions = { to_formats: ["md"], pipeline: "standard" };
const api = createAPIClient("http://localhost", { retries: 0 });
const cli = createCLIClient();
void api.convert(new Uint8Array(), "a.pdf", options);
void cli.convert("a.pdf", "a.pdf", options);
void browserAPI("http://localhost");
`);
    await writeFile(join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: false, lib: ["ES2022", "DOM"] }, files: ["types.ts"] }));
    await exec(process.execPath, [join(consumer, "node_modules/typescript/bin/tsc"), "--project", join(consumer, "tsconfig.json")], { cwd: consumer, maxBuffer: 4 * 1024 * 1024 });
    console.log("Packed declarations and documented OpenAPI example compile with TypeScript 5.5.4");
  }
  assert(requests.some((request) => request.key === "packed-key"));
  console.log(`Consumer evidence retained at ${directory}`);
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
