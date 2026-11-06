import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";

const schemaUrl = new URL("../openapi/docling-serve.json", import.meta.url);
const output = new URL("../src/types/generated/api.ts", import.meta.url);
const schema = await readFile(schemaUrl);
const provenance = JSON.parse(await readFile(new URL("../openapi/schema-provenance.json", import.meta.url), "utf8"));
const actual = createHash("sha256").update(schema).digest("hex");
if (actual !== provenance.schema_sha256) {
  throw new Error("Schema digest differs from reviewed provenance; review the schema update first");
}
const spec = JSON.parse(schema);
if (spec.info.version !== provenance.packages["docling-serve"]) {
  throw new Error("Schema version differs from the pinned Serve version");
}
function verifyLocalRefs(value) {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string" && !value.$ref.startsWith("#/")) {
    throw new Error("Pinned schema must use local references only");
  }
  for (const child of Object.values(value)) verifyLocalRefs(child);
}
verifyLocalRefs(spec);
const generated = COMMENT_HEADER + astToString(await openapiTS(spec));
if (process.argv.includes("--check")) {
  if (await readFile(output, "utf8") !== generated) throw new Error("Generated types are stale; run npm run openapi:generate");
  console.log("Pinned schema and generated types match");
} else {
  await writeFile(output, generated);
  console.log(`Generated types from Serve ${spec.info.version}`);
}
