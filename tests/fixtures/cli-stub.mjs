#!/usr/bin/env node
// Synthetic CLI: never imports a converter, Python package, or model.
import { appendFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const config = JSON.parse(await readFile(`${fileURLToPath(import.meta.url)}.json`, "utf8"));
const argv = process.argv.slice(2);
const args = argv[0] === "-m" ? argv.slice(2) : argv;
const version = args.includes("--version");
await appendFile(config.log, `${JSON.stringify({ argv, version, cwd: process.cwd(), pid: process.pid })}\n`);
if (version) {
  console.log("SYNTHETIC docling stub 1.0");
  process.exit(config.versionExitCode ?? 0);
}
if (config.echo) {
  console.log(JSON.stringify(argv));
  process.exit(0);
}
const output = args[args.indexOf("--output") + 1];
const format = args[args.indexOf("--to") + 1];
// The SDK's main conversion path puts the source first; its CLI-options API puts it last.
const input = args[0].startsWith("--") ? args.at(-1) : args[0];
const stem = basename(input, extname(input));
const extension = format === "text" ? "txt" : format === "html_split_page" ? "html" : format;
const expected = join(output, `${stem}.${extension}`);
const behavior = config.files?.[basename(input)] ?? config.formats?.[format] ?? config.behavior ?? "write";
if (config.delay) await delay(config.delay);
if (behavior === "parent-signal") {
  // Leave an artifact behind and exit zero when the SDK forwards cancellation.
  // The public client must still reject with the parent's abort and remove it.
  const exitOnSignal = () => {
    const milliseconds = config.signalExitDelays?.[basename(input)] ?? 0;
    if (milliseconds) setTimeout(() => process.exit(0), milliseconds);
    else process.exit(0);
  };
  process.on("SIGINT", exitOnSignal);
  process.on("SIGTERM", exitOnSignal);
  await writeFile(expected, "interrupted output");
  console.error(`PARENT_SIGNAL_READY:${process.ppid}:${process.pid}`);
  await new Promise(() => setInterval(() => {}, 1000));
}
if (behavior === "timeout") {
  await new Promise(() => setInterval(() => {}, 1000));
}
if (behavior === "signal") process.kill(process.pid, "SIGTERM");
if (behavior === "nonzero") {
  console.error("temporary failure: connection timeout; synthetic exit, do not retry");
  process.exit(7);
}
if (behavior === "none") process.exit(0);
if (behavior === "symlink") {
  await symlink(config.escapeTarget, expected);
} else if (behavior === "directory-symlink") {
  await rm(output, { recursive: true });
  await symlink(config.escapeTarget, output, "dir");
} else {
  const source = await readFile(input, "utf8");
  let asset;
  if (config.assets) {
    const directory = join(output, `${stem}_artifacts`);
    await mkdir(directory);
    asset = join(directory, "image.png");
    if (config.assetSymlink) await symlink(config.escapeTarget, asset);
    else await writeFile(asset, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
  }
  let content = behavior === "empty" ? ""
    : behavior === "invalid-json" ? "{not JSON}"
    : behavior === "wrong-json" ? JSON.stringify(config.jsonValue ?? [])
    : format === "json" ? JSON.stringify({ name: stem, main_text: [], description: source, ...(asset && {pictures: [{ image: { uri: asset } }]}), ...(config.assetMetadata && { metadata: { exactPath: asset, sentence: `keep ${asset} unchanged`, external: { uri: `${asset}.unowned` }, structured: { uri: { value: "$&/$$" } }, list: [{ uri: asset }] } }), ...(config.jsonStatus && { status: config.jsonStatus }) })
    : format === "html_split_page" ? `<html data-style="split-page"><body>${source}</body></html>`
    : format === "html" ? `<html><body>${source}${asset ? `<img src="${config.quoteAssets ? encodeURIComponent(asset).replaceAll("%2F", "/") : asset}">` : ""}</body></html>`
    : format === "md" && asset ? `${source}\n![Image](${asset})`
    : source;
  // Python json.dump defaults to ensure_ascii=True, unlike JSON.stringify.
  if (format === "json" && config.ensureAscii)
    content = content.replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  await writeFile(behavior === "generic" ? join(output, `output.${extension}`) : expected, content);
}
console.error("Processing 50%\nSaving synthetic output");
if (config.status || config.errors) console.log(JSON.stringify({ status: config.status, errors: config.errors }));
if (behavior === "write-then-fail") process.exit(9);
