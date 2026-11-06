import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProcessRunResult } from "../cli/process-runner";
import type { NativeInputSnapshot } from "./input";
import { NATIVE_LIMITS } from "./limits";
import {
  type NativeConversionResult,
  NativeError,
  type NativeFormat,
  type NativeOutputFile,
  type NativePageCoverage,
} from "./types";

function invalid(message: string): never {
  throw new NativeError("INVALID_OUTPUT", message);
}

function execution(message: string): never {
  throw new NativeError("EXECUTION_FAILED", message);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12;
}

function pageNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= NATIVE_LIMITS.maxPages
  );
}

interface Protocol {
  status: "success" | "partial" | "failure";
  expected?: number;
  warnings: string[];
}

function parseProtocol(
  input: NativeInputSnapshot,
  outputDirectory: string,
  result: ProcessRunResult
): Protocol {
  if (
    result.signal ||
    result.exitCode === null ||
    ![0, 1].includes(result.exitCode) ||
    result.success !== (result.exitCode === 0)
  )
    execution("Native process did not complete normally");
  if (
    Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) >
    NATIVE_LIMITS.diagnosticBytes
  )
    execution("Native diagnostics exceeded the byte limit");
  const lines = result.stderr.split(/\r?\n/).filter((line) => line.length > 0);
  const summaries = lines.filter((line) => line.startsWith("batch:"));
  const summary = summaries[0];
  if (summaries.length !== 1 || lines.at(-1) !== summary)
    execution("Native process has no unique final batch-of-one summary");
  const match = /^batch: (\d+) converted, (\d+) failed(?:, (\d+) partial)?$/.exec(summary ?? "");
  if (!match) execution("Unrecognized native batch protocol");
  const converted = Number(match[1]);
  const failed = Number(match[2]);
  const partial = Number(match[3] ?? 0);
  if (converted + failed + partial !== 1 || (match[3] !== undefined && partial !== 1))
    execution("Native batch protocol is not one document");
  const labels = new Set([input.path, `/work/input/source.${input.format}`]);
  const starts = lines.filter((line) => line.startsWith("start:"));
  if (starts.length !== 1) execution("Native process has no unique input start diagnostic");
  let expected: number | undefined;
  const start = starts[0]?.slice(7) ?? "";
  if (!labels.has(start)) {
    const count = /^(.*) \((\d+) (page|pages)\)$/.exec(start);
    if (
      !count ||
      !labels.has(count[1] ?? "") ||
      input.format !== "pdf" ||
      Number(count[2]) > NATIVE_LIMITS.maxPages ||
      count[3] !== (Number(count[2]) === 1 ? "page" : "pages")
    )
      execution("Native start diagnostic does not identify the owned input");
    expected = Number(count[2]);
  }
  const startedLabel = / \(\d+ pages?\)$/.test(start)
    ? start.replace(/ \(\d+ pages?\)$/, "")
    : start;
  const outcomes = lines.filter((line) => /^(?:ok|partial):/.test(line));
  const errors = lines.filter((line) => line.startsWith("error:"));
  const warnings = lines.filter(
    (line) =>
      line !== summary &&
      /\b(?:warn(?:ing)?|error|fatal|exception|fail(?:ed|ure)?)\b|\[E:onnxruntime|no fallback font|document timeout|(?:ocr|tableformer).*?(?:unavailable|not found|fallback|missing)/i.test(
        line
      )
  );
  const stdout = result.stdout.split(/\r?\n/).filter(Boolean);
  if (failed === 1) {
    if (
      result.exitCode !== 1 ||
      outcomes.length ||
      !errors.some((line) => line.startsWith(`error: ${startedLabel}: `)) ||
      stdout.length
    )
      execution("Conflicting native failure protocol");
    return { status: "failure", expected, warnings };
  }
  if (result.exitCode !== 0 || outcomes.length !== 1 || errors.length)
    execution("Conflicting native conversion protocol");
  const outcome = outcomes[0] ?? "";
  const tag = partial === 1 ? "partial" : "ok";
  const prefix = `${tag}: ${startedLabel} -> `;
  if (!outcome.startsWith(prefix)) execution("Native outcome does not identify the owned input");
  const written = /^(.*) \(\d+\.\d+s(?:, \d+ ms\/page)?\)$/.exec(outcome.slice(prefix.length));
  if (!written) execution("Unrecognized native output diagnostic");
  const sandboxPaths = ["/work/output/source.md", "/work/output/source.json"];
  const hostPaths = [
    join(resolve(outputDirectory), "source.md"),
    join(resolve(outputDirectory), "source.json"),
  ];
  if (
    ![sandboxPaths, hostPaths].some(
      (paths) =>
        written[1] === paths.join(", ") &&
        stdout.length === paths.length &&
        stdout.every((path, index) => path === paths[index])
    )
  )
    execution("Native output diagnostics do not identify the two owned formats");
  if (lines.indexOf(outcome) <= lines.indexOf(starts[0] ?? ""))
    execution("Native conversion diagnostics are out of order");
  return { status: partial === 1 ? "partial" : "success", expected, warnings };
}

interface InventoryFile {
  file: NativeOutputFile;
  bytes: Buffer;
}

async function inventory(directory: string): Promise<Map<string, InventoryFile>> {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    invalid("Native output directory is not a regular owned directory");
  const files = new Map<string, InventoryFile>();
  let total = 0;
  let entries = 0;
  const scan = async (relative: string): Promise<void> => {
    // The tree is bounded before allocating an unbounded readdir result.
    const scanPath = join(directory, relative);
    const beforeDirectory = await lstat(scanPath, { bigint: true });
    if (!beforeDirectory.isDirectory() || beforeDirectory.isSymbolicLink())
      invalid("Native output directory was replaced");
    const handle = await opendir(scanPath);
    for await (const entry of handle) {
      if (++entries > NATIVE_LIMITS.outputFiles + 1)
        invalid("Native output exceeds file count limit");
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = join(directory, path);
      const before = await lstat(absolute, { bigint: true });
      if (before.isSymbolicLink()) invalid("Native output contains a symlink");
      if (before.isDirectory()) {
        if (path !== "source_artifacts") invalid("Native output contains an unexpected directory");
        await scan(path);
        continue;
      }
      if (!before.isFile() || before.nlink !== 1n)
        invalid("Native output contains a hardlink or special file");
      let kind: NativeOutputFile["kind"];
      if (path === "source.md") kind = "md";
      else if (path === "source.json") kind = "json";
      else if (/^source_artifacts\/image_\d{6}\.[a-z0-9]+$/.test(path)) kind = "asset";
      else invalid("Native output contains an unexpected file");
      if (
        files.size >= NATIVE_LIMITS.outputFiles ||
        before.size > BigInt(NATIVE_LIMITS.outputBytes - total)
      )
        invalid("Native output exceeds byte or file count limit");
      const source = await open(
        absolute,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      );
      let bytes: Buffer;
      try {
        const opened = await source.stat({ bigint: true });
        if (
          !opened.isFile() ||
          opened.nlink !== 1n ||
          opened.ino !== before.ino ||
          opened.dev !== before.dev ||
          opened.size !== before.size ||
          opened.mtimeNs !== before.mtimeNs ||
          opened.ctimeNs !== before.ctimeNs
        )
          invalid("Native output changed while opening");
        const chunks: Buffer[] = [];
        let size = 0;
        const buffer = Buffer.alloc(64 * 1024);
        for (;;) {
          const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          size += bytesRead;
          if (BigInt(size) > opened.size || total + size > NATIVE_LIMITS.outputBytes)
            invalid("Native output grew while reading");
          chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
        }
        const after = await source.stat({ bigint: true });
        const named = await lstat(absolute, { bigint: true });
        if (
          BigInt(size) !== opened.size ||
          after.size !== opened.size ||
          after.nlink !== 1n ||
          after.mtimeNs !== opened.mtimeNs ||
          after.ctimeNs !== opened.ctimeNs ||
          named.isSymbolicLink() ||
          named.ino !== opened.ino ||
          named.dev !== opened.dev ||
          named.ctimeNs !== opened.ctimeNs
        )
          invalid("Native output changed while reading");
        bytes = Buffer.concat(chunks);
      } finally {
        await source.close();
      }
      total += bytes.length;
      if (kind === "asset") validateRaster(path.split(".").at(-1) ?? "", bytes);
      files.set(path, {
        bytes,
        file: {
          path,
          kind,
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });
    }
    const afterDirectory = await lstat(scanPath, { bigint: true });
    if (
      afterDirectory.isSymbolicLink() ||
      afterDirectory.ino !== beforeDirectory.ino ||
      afterDirectory.dev !== beforeDirectory.dev ||
      afterDirectory.mtimeNs !== beforeDirectory.mtimeNs ||
      afterDirectory.ctimeNs !== beforeDirectory.ctimeNs
    )
      invalid("Native output inventory changed during inspection");
  };
  await scan("");
  // Detect directory replacement/addition during inspection as well as file replacement.
  const after = await lstat(directory);
  if (
    after.isSymbolicLink() ||
    after.ino !== root.ino ||
    after.dev !== root.dev ||
    after.mtimeMs !== root.mtimeMs ||
    after.ctimeMs !== root.ctimeMs
  )
    invalid("Native output inventory changed during inspection");
  return files;
}

function validateRaster(extension: string, bytes: Buffer): void {
  let valid = false;
  switch (extension) {
    case "png":
      valid =
        bytes.length >= 33 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("latin1", 12, 16) === "IHDR" &&
        bytes.readUInt32BE(16) > 0 &&
        bytes.readUInt32BE(20) > 0 &&
        validPngChunks(bytes);
      break;
    case "jpg":
    case "jpeg":
      valid =
        bytes.length >= 4 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff &&
        bytes[bytes.length - 2] === 0xff &&
        bytes[bytes.length - 1] === 0xd9 &&
        validJpegHeaders(bytes);
      break;
    case "gif":
      valid =
        bytes.length >= 20 &&
        /^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6)) &&
        bytes.readUInt16LE(6) > 0 &&
        bytes.readUInt16LE(8) > 0 &&
        bytes[bytes.length - 1] === 0x3b &&
        bytes.indexOf(0x2c, 13) >= 13;
      break;
    case "webp":
      valid =
        bytes.length >= 25 &&
        bytes.toString("latin1", 0, 4) === "RIFF" &&
        bytes.readUInt32LE(4) + 8 === bytes.length &&
        bytes.toString("latin1", 8, 12) === "WEBP" &&
        ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("latin1", 12, 16)) &&
        bytes.readUInt32LE(16) >= (bytes.toString("latin1", 12, 16) === "VP8L" ? 5 : 10) &&
        bytes.readUInt32LE(16) + 20 <= bytes.length;
      break;
    case "bmp":
      valid =
        bytes.length >= 26 &&
        bytes.toString("latin1", 0, 2) === "BM" &&
        bytes.readUInt32LE(2) === bytes.length &&
        bytes.readUInt32LE(10) < bytes.length &&
        (bytes.readUInt32LE(14) === 12 || bytes.readUInt32LE(14) >= 40);
      break;
    case "tif":
    case "tiff":
      valid =
        bytes.length >= 8 &&
        (bytes.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) ||
          bytes.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42])));
      if (valid) {
        const little = bytes[0] === 73;
        const offset = little ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4);
        valid = offset >= 8 && offset + 2 <= bytes.length;
        if (valid) {
          const entries = little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
          valid = entries > 0 && offset + 2 + entries * 12 + 4 <= bytes.length;
        }
      }
      break;
    default:
      invalid(
        `Unsupported native image asset type: ${extension || "unknown"}; SVG and active content are forbidden`
      );
  }
  if (!valid) invalid(`Native image asset does not match its raster type: ${extension}`);
}

// Check raster container structure without executing a decoder or inflating pixel buffers.
function validPngChunks(bytes: Buffer): boolean {
  let offset = 8;
  let data = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || offset + 12 + size > bytes.length) return false;
    if ((offset === 8 && (type !== "IHDR" || size !== 13)) || (offset !== 8 && type === "IHDR"))
      return false;
    if (type === "IDAT") data = true;
    if (type === "IEND") return data && size === 0 && offset + 12 === bytes.length;
    offset += size + 12;
  }
  return false;
}

function validJpegHeaders(bytes: Buffer): boolean {
  let offset = 2;
  let geometry = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      offset + 2 > bytes.length
    )
      return false;
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length - 2) return false;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker
      )
    ) {
      if (size < 8 || bytes.readUInt16BE(offset + 3) === 0 || bytes.readUInt16BE(offset + 5) === 0)
        return false;
      geometry = true;
    }
    if (marker === 0xda) return geometry && size >= 6 && offset + size < bytes.length - 2;
    offset += size;
  }
  return false;
}

const arrays = ["groups", "texts", "pictures", "tables", "key_value_items", "form_items"] as const;

function inspectDocument(bytes: Buffer): { document: Record<string, unknown>; pages: number[] } {
  const document: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    !object(document) ||
    document.schema_name !== "DoclingDocument" ||
    document.version !== "1.10.0" ||
    typeof document.name !== "string" ||
    !object(document.origin) ||
    typeof document.origin.filename !== "string" ||
    typeof document.origin.mimetype !== "string" ||
    typeof document.origin.binary_hash !== "number" ||
    !Number.isInteger(document.origin.binary_hash) ||
    document.origin.binary_hash > 2 ** 64 ||
    document.origin.binary_hash < 0 ||
    !object(document.pages)
  )
    invalid("Native JSON does not match DoclingDocument 1.10.0");
  for (const key of arrays)
    if (!Array.isArray(document[key])) invalid(`Native JSON is missing required array: ${key}`);
  const pages: number[] = [];
  for (const [key, page] of Object.entries(document.pages)) {
    if (
      !object(page) ||
      !pageNumber(page.page_no) ||
      String(page.page_no) !== key ||
      !object(page.size) ||
      !finite(page.size.width) ||
      !finite(page.size.height) ||
      page.size.width <= 0 ||
      page.size.height <= 0
    )
      invalid("Native JSON has invalid page geometry or numbering");
    pages.push(page.page_no);
  }
  if (pages.length > NATIVE_LIMITS.maxPages) invalid("Native JSON exceeds page count limit");
  pages.sort((a, b) => a - b);
  const refs = new Set(["#/body", "#/furniture"]);
  for (const key of [...arrays, "field_items", "field_regions"]) {
    const items = document[key];
    if (items === undefined) continue;
    if (!Array.isArray(items)) invalid("Native JSON item collection is not an array");
    items.forEach((item, index) => {
      if (!object(item) || item.self_ref !== `#/${key}/${index}`)
        invalid("Native JSON has invalid item identity");
      if (
        !object(item.parent) ||
        !Array.isArray(item.children) ||
        typeof item.content_layer !== "string" ||
        typeof item.label !== "string" ||
        (key !== "groups" && !Array.isArray(item.prov))
      )
        invalid("Native JSON has an invalid document item");
      if (key === "texts" && (typeof item.text !== "string" || typeof item.orig !== "string"))
        invalid("Native JSON has invalid text content");
      if (
        key === "tables" &&
        (!object(item.data) ||
          !Number.isSafeInteger(item.data.num_rows) ||
          !Number.isSafeInteger(item.data.num_cols) ||
          Number(item.data.num_rows) < 0 ||
          Number(item.data.num_cols) < 0 ||
          !Array.isArray(item.data.table_cells) ||
          !Array.isArray(item.data.grid))
      )
        invalid("Native JSON has invalid table data");
      refs.add(item.self_ref);
    });
  }
  for (const root of ["body", "furniture"]) {
    const value = document[root];
    if (
      !object(value) ||
      value.self_ref !== `#/${root}` ||
      !Array.isArray(value.children) ||
      typeof value.content_layer !== "string" ||
      typeof value.name !== "string" ||
      typeof value.label !== "string"
    )
      invalid("Native JSON has an invalid document root");
  }
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 2000000 || depth > 128) invalid("Native JSON exceeds structural limits");
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!object(value)) return;
    if ("$ref" in value && (typeof value.$ref !== "string" || !refs.has(value.$ref)))
      invalid("Native JSON contains an unresolved document reference");
    if ("prov" in value) {
      if (!Array.isArray(value.prov)) invalid("Native JSON has invalid provenance");
      for (const prov of value.prov) {
        if (
          !object(prov) ||
          !pageNumber(prov.page_no) ||
          !Object.hasOwn(document.pages as object, String(prov.page_no)) ||
          !object(prov.bbox) ||
          !["l", "t", "r", "b"].every((key) =>
            finite(prov.bbox && (prov.bbox as Record<string, unknown>)[key])
          ) ||
          !["TOPLEFT", "BOTTOMLEFT"].includes(String(prov.bbox.coord_origin)) ||
          !Array.isArray(prov.charspan) ||
          prov.charspan.length !== 2 ||
          !prov.charspan.every((number) => Number.isSafeInteger(number) && number >= 0) ||
          prov.charspan[0] > prov.charspan[1]
        )
          invalid("Native JSON has invalid page provenance");
      }
    }
    if ("image" in value && value.image !== null) {
      const image = value.image;
      if (
        !object(image) ||
        typeof image.uri !== "string" ||
        typeof image.mimetype !== "string" ||
        !object(image.size) ||
        !finite(image.size.width) ||
        !finite(image.size.height) ||
        image.size.width <= 0 ||
        image.size.height <= 0 ||
        !finite(image.dpi) ||
        image.dpi <= 0
      )
        invalid("Native JSON has an invalid embedded image");
      const match =
        /^data:(image\/(?:png|jpeg|gif|webp|bmp|tiff));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
          image.uri
        );
      if (!match || match[1] !== image.mimetype || !match[2] || match[2].length % 4 !== 0)
        invalid("Native JSON image must remain an embedded supported raster data URI");
      const decoded = Buffer.from(match[2], "base64");
      if (decoded.toString("base64") !== match[2])
        invalid("Native JSON image has invalid base64 data");
      validateRaster(
        image.mimetype.slice(6).replace("jpeg", "jpg").replace("tiff", "tif"),
        decoded
      );
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(document, 0);
  return { document, pages };
}

function inspectMarkdown(bytes: Buffer, files: Map<string, InventoryFile>): Set<string> {
  let markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (markdown.includes("\0")) invalid("Native Markdown contains NUL bytes");
  // Strip fenced code by line; a closing fence cannot have an info string.
  let fence: { char: string; length: number } | undefined;
  markdown = markdown
    .split("\n")
    .map((line) => {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (
          match &&
          match[1]?.[0] === fence.char &&
          match[1].length >= fence.length &&
          !match[2]?.trim()
        )
          fence = undefined;
        return "";
      }
      if (match && !(match[1]?.[0] === "`" && match[2]?.includes("`"))) {
        fence = { char: match[1]?.[0] ?? "`", length: match[1]?.length ?? 3 };
        return "";
      }
      return line;
    })
    .join("\n");
  const used = new Set<string>();
  const own = (uri: string): void => {
    let path: string;
    try {
      path = decodeURIComponent(uri.replace(/\\([\\()[\]<> ])/g, "$1"));
    } catch {
      invalid("Native Markdown image has an invalid URI");
    }
    if (
      !/^source_artifacts\/image_\d{6}\.(?:png|jpe?g|gif|webp|bmp|tiff?)$/.test(path) ||
      !files.has(path)
    )
      invalid("Native Markdown image is missing, remote or outside the owned inventory");
    used.add(path);
  };
  const definitions = new Map<string, string>();
  const normalize = (label: string): string => label.trim().replace(/\s+/g, " ").toLowerCase();
  for (const match of markdown.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gm)) {
    const label = normalize(match[1] ?? "");
    if (definitions.has(label))
      invalid("Native Markdown has ambiguous image reference definitions");
    definitions.set(label, match[2] ?? match[3] ?? "");
  }
  for (let index = 0; index < markdown.length; index++) {
    if (markdown[index] === "\\") {
      index++;
      continue;
    }
    if (markdown[index] === "`") {
      let length = 1;
      while (markdown[index + length] === "`") length++;
      const delimiter = "`".repeat(length);
      let close = markdown.indexOf(delimiter, index + length);
      while (close >= 0 && (markdown[close - 1] === "`" || markdown[close + length] === "`"))
        close = markdown.indexOf(delimiter, close + length);
      if (close >= 0) index = close + length - 1;
      else index += length - 1;
      continue;
    }
    if (
      markdown[index] === "<" &&
      /^<\s*(?:img|svg|picture|source|object|embed)\b/i.test(markdown.slice(index, index + 64))
    )
      invalid("Native Markdown contains an unsupported HTML image element");
    if (markdown.slice(index, index + 2) !== "![") continue;
    let end = index + 2;
    let brackets = 1;
    for (; end < markdown.length && brackets; end++) {
      if (markdown[end] === "\\") {
        end++;
        continue;
      }
      if (markdown[end] === "[") brackets++;
      if (markdown[end] === "]") brackets--;
    }
    if (brackets) invalid("Native Markdown contains a malformed image reference");
    const alt = markdown.slice(index + 2, end - 1);
    if (markdown[end] === "(") {
      let close = end + 1;
      let parentheses = 1;
      let angle = false;
      for (; close < markdown.length && parentheses; close++) {
        const char = markdown[close];
        if (char === "\\") {
          close++;
          continue;
        }
        if (char === "<") angle = true;
        if (char === ">") angle = false;
        if (!angle && char === "(") parentheses++;
        if (!angle && char === ")") parentheses--;
      }
      if (parentheses) invalid("Native Markdown contains an unterminated image URI");
      const destination = markdown.slice(end + 1, close - 1).trim();
      const match =
        /^(?:<([^<>\n]+)>|((?:\\.|[^\s])+?))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^\n]*\)))?$/.exec(
          destination
        );
      if (!match) invalid("Native Markdown contains an unsupported image destination");
      own(match[1] ?? match[2] ?? "");
      index = close - 1;
    } else {
      let label = alt;
      if (markdown[end] === "[") {
        const close = markdown.indexOf("]", end + 1);
        if (close < 0) invalid("Native Markdown contains an unterminated image label");
        label = markdown.slice(end + 1, close) || alt;
        end = close + 1;
      }
      const destination = definitions.get(normalize(label));
      if (!destination) invalid("Native Markdown image reference has no owned destination");
      own(destination);
      index = end - 1;
    }
  }
  return used;
}

/** Inspect only the fixed artifacts emitted by the pinned, batch-of-one compiler invocation. */
export async function inspectNativeOutputs(
  outputDirectory: string,
  input: NativeInputSnapshot,
  formats: readonly NativeFormat[],
  processResult: ProcessRunResult,
  pageRange?: readonly [number, number]
): Promise<Omit<NativeConversionResult, "outputDirectory" | "input" | "runtime">> {
  if (
    !formats.length ||
    formats.some((format) => format !== "md" && format !== "json") ||
    new Set(formats).size !== formats.length
  )
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "Native output formats must be a nonempty unique selection of md and json"
    );
  if (
    pageRange &&
    (input.format !== "pdf" ||
      !pageNumber(pageRange[0]) ||
      !pageNumber(pageRange[1]) ||
      pageRange[0] > pageRange[1])
  )
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "Native page range must be an inclusive PDF page range"
    );
  const protocol = parseProtocol(input, outputDirectory, processResult);
  const coverage: NativePageCoverage = {
    basis:
      input.format === "pdf"
        ? "engine-reported"
        : input.format === "pptx"
          ? "office-package"
          : "not-reported",
    ...(pageRange ? { requested: [pageRange[0], pageRange[1]] as const } : {}),
    completed: [],
  };
  const expected =
    input.format === "pdf"
      ? protocol.expected
      : input.format === "pptx"
        ? input.expectedPages
        : undefined;
  if (expected !== undefined) coverage.expected = expected;
  const warnings = [...protocol.warnings];
  let files: Map<string, InventoryFile>;
  try {
    files = await inventory(outputDirectory);
  } catch (cause) {
    if (cause instanceof NativeError) throw cause;
    throw new NativeError("INVALID_OUTPUT", "Unable to inspect the owned native output inventory", {
      cause,
    });
  }
  if (protocol.status === "failure") return { status: "failure", files: [], coverage, warnings };
  let document: Record<string, unknown> | undefined;
  let markdown = false;
  let assets = new Set<string>();
  const json = files.get("source.json");
  try {
    if (!json) invalid("Native output is missing source.json");
    const inspected = inspectDocument(json.bytes);
    document = inspected.document;
    coverage.completed = inspected.pages;
  } catch (cause) {
    warnings.push(
      `JSON validation failed: ${cause instanceof Error ? cause.message : "invalid document"}`
    );
  }
  const md = files.get("source.md");
  try {
    if (!md) invalid("Native output is missing source.md");
    assets = inspectMarkdown(md.bytes, files);
    markdown = true;
  } catch (cause) {
    markdown = false;
    assets = new Set();
    warnings.push(
      `Markdown validation failed: ${cause instanceof Error ? cause.message : "invalid document"}`
    );
  }
  if (markdown)
    for (const [path, file] of files)
      if (file.file.kind === "asset" && !assets.has(path))
        invalid("Native output contains an unreferenced image asset");
  if (input.format !== "docx") {
    if (expected === undefined)
      warnings.push("Expected page count was not reported; page coverage is unknown");
    else {
      const first = pageRange?.[0] ?? 1;
      coverage.complete =
        document !== undefined &&
        expected > 0 &&
        coverage.completed.length === expected &&
        coverage.completed.every(
          (page, index) => page === first + index && (!pageRange || page <= pageRange[1])
        );
      if (!coverage.complete)
        warnings.push("Validated JSON page coverage does not match the expected pages");
    }
  }
  const selected: NativeOutputFile[] = [];
  for (const format of formats)
    if ((format === "json" && document) || (format === "md" && markdown)) {
      const file = files.get(`source.${format}`);
      if (file) selected.push(file.file);
    }
  if (selected.length)
    for (const path of [...assets].sort()) {
      const file = files.get(path);
      if (file) selected.push(file.file);
    }
  const status = !selected.length
    ? "failure"
    : protocol.status === "success" && document && markdown && !warnings.length
      ? "success"
      : "partial_success";
  return {
    status,
    files: selected,
    ...(formats.includes("json") && document ? { document } : {}),
    coverage,
    warnings,
  };
}
