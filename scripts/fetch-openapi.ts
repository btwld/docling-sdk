#!/usr/bin/env tsx
/** Fetch JSON only; schema updates require reviewing provenance before regeneration. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { url: { type: "string" }, output: { type: "string" } } });
const provenance = JSON.parse(await readFile(new URL("../openapi/schema-provenance.json", import.meta.url), "utf8"));
const base = new URL(values.url ?? process.env.DOCLING_URL ?? "http://localhost:5000");
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
  throw new Error("Use an HTTP(S) server URL without embedded credentials");
}
const response = await fetch(`${base.toString().replace(/\/$/, "")}/openapi.json`, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`OpenAPI fetch failed with HTTP ${response.status}`);
const body = await response.text();
const spec = JSON.parse(body);
if (!spec.openapi?.startsWith("3.") || !spec.paths || typeof spec.paths !== "object" || Array.isArray(spec.paths)) {
  throw new Error("Response is not an OpenAPI 3 JSON document");
}
if (spec.info?.version !== provenance.packages["docling-serve"]) {
  throw new Error(`Expected Serve ${provenance.packages["docling-serve"]}; review a version upgrade explicitly`);
}
const output = resolve(values.output ?? "openapi/docling-serve.json");
await mkdir(dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, body.endsWith("\n") ? body : `${body}\n`, { flag: "wx" });
await rename(temporary, output);
console.log(`Saved ${Object.keys(spec.paths).length} paths. Review the schema and update its provenance digest before generating types.`);
