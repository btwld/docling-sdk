import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, extname, join, posix, resolve } from "node:path";
import { NATIVE_LIMITS } from "./limits";
import { NativeError, type NativeInputFormat } from "./types";

export interface NativeInputSnapshot {
  path: string;
  filename: string;
  format: NativeInputFormat;
  size: number;
  sha256: string;
  expectedPages?: number;
}

function invalid(message: string): never {
  throw new NativeError("INVALID_INPUT", message);
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new NativeError("ABORTED", "Native input snapshot was aborted");
}

const officeNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const strictOfficeNs = "http://purl.oclc.org/ooxml/officeDocument/relationships";
const packageNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const wordNs = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const presentationNs = new Set([
  "http://schemas.openxmlformats.org/presentationml/2006/main",
  "http://purl.oclc.org/ooxml/presentationml/main",
]);

interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

interface XmlPart {
  root: string;
  namespace: string;
  elements: Set<string>;
  relationships: Relationship[];
  references: Set<string>;
  slides: string[];
}

interface ZipMember {
  name: string;
  offset: number;
  compressed: number;
  expanded: number;
  crc: number;
  method: number;
  flags: number;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function zipMembers(bytes: Buffer): ZipMember[] {
  // Read the directory ourselves: inflater output allocation must never trust ZIP size fields.
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (
      bytes.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + bytes.readUInt16LE(end + 20) === bytes.length
    )
      break;
  }
  if (
    end < Math.max(0, bytes.length - 65557) ||
    bytes.readUInt32LE(end) !== 0x06054b50 ||
    end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length
  )
    invalid("Office input has no valid ZIP directory");
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    count === 0 ||
    count > NATIVE_LIMITS.archiveEntries ||
    start + bytes.readUInt32LE(end + 12) !== end
  )
    invalid("Unsupported or excessive Office ZIP directory (multi-disk/ZIP64 is unsupported)");
  const names = new Set<string>();
  const members: ZipMember[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let cursor = start;
  let declaredBytes = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      invalid("Malformed Office ZIP directory");
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const next =
      cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    if (next > end || bytes.readUInt16LE(cursor + 34) !== 0) invalid("Malformed Office ZIP member");
    validateZipExtra(
      bytes.subarray(
        cursor + 46 + nameLength,
        cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30)
      )
    );
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (
      !(bytes.readUInt16LE(cursor + 8) & 0x0800) &&
      [...name].some((char) => char.charCodeAt(0) > 127)
    )
      invalid("Office ZIP has ambiguous non-UTF8 member names");
    const components = name.replace(/\/$/, "").split("/");
    if (
      !name ||
      /[\\%:]/.test(name) ||
      [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      components.some((part) => !part || part === "." || part === "..")
    ) {
      invalid("Unsafe Office ZIP member path");
    }
    const canonical = name.replace(/\/$/, "");
    if (names.has(canonical)) invalid("Duplicate Office ZIP member");
    names.add(canonical);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    const type = mode & 0xf000;
    if (type && type !== (name.endsWith("/") ? 0x4000 : 0x8000))
      invalid("Office ZIP contains a link or special file");
    const member: ZipMember = {
      name,
      flags: bytes.readUInt16LE(cursor + 8),
      method: bytes.readUInt16LE(cursor + 10),
      crc: bytes.readUInt32LE(cursor + 16),
      compressed: bytes.readUInt32LE(cursor + 20),
      expanded: bytes.readUInt32LE(cursor + 24),
      offset: bytes.readUInt32LE(cursor + 42),
    };
    if ((member.flags & ~0x080e) !== 0 || (member.method !== 0 && member.method !== 8))
      invalid("Encrypted or unsupported Office ZIP member");
    declaredBytes += member.expanded;
    if (declaredBytes > NATIVE_LIMITS.archiveBytes || member.compressed > bytes.length)
      invalid("Office ZIP exceeds archive byte limit");
    if (/\.(xml|rels)$/i.test(name) && member.expanded > NATIVE_LIMITS.xmlBytes)
      invalid("Office XML exceeds byte limit");
    if (member.offset + 30 > start || bytes.readUInt32LE(member.offset) !== 0x04034b50)
      invalid("Missing Office ZIP local header");
    const localNameLength = bytes.readUInt16LE(member.offset + 26);
    const data = member.offset + 30 + localNameLength + bytes.readUInt16LE(member.offset + 28);
    validateZipExtra(bytes.subarray(member.offset + 30 + localNameLength, data));
    if (
      data + member.compressed > start ||
      !bytes
        .subarray(member.offset + 30, member.offset + 30 + localNameLength)
        .equals(bytes.subarray(cursor + 46, cursor + 46 + nameLength)) ||
      bytes.readUInt16LE(member.offset + 6) !== member.flags ||
      bytes.readUInt16LE(member.offset + 8) !== member.method
    )
      invalid("Inconsistent Office ZIP local header");
    for (const [field, expected] of [
      [14, member.crc],
      [18, member.compressed],
      [22, member.expanded],
    ] as const) {
      const local = bytes.readUInt32LE(member.offset + field);
      if (local !== expected && (!(member.flags & 8) || local !== 0))
        invalid("Inconsistent Office ZIP size or checksum");
    }
    members.push(member);
    cursor = next;
  }
  if (cursor !== end) invalid("Unexpected Office ZIP directory data");
  let consumed = 0;
  for (const member of [...members].sort((a, b) => a.offset - b.offset)) {
    if (member.offset !== consumed) invalid("Overlapping or unowned Office ZIP data");
    consumed =
      member.offset +
      30 +
      bytes.readUInt16LE(member.offset + 26) +
      bytes.readUInt16LE(member.offset + 28) +
      member.compressed;
    if (member.flags & 8) {
      if (consumed + 12 > start) invalid("Missing Office ZIP data descriptor");
      if (bytes.readUInt32LE(consumed) === 0x08074b50) consumed += 4;
      if (
        consumed + 12 > start ||
        bytes.readUInt32LE(consumed) !== member.crc ||
        bytes.readUInt32LE(consumed + 4) !== member.compressed ||
        bytes.readUInt32LE(consumed + 8) !== member.expanded
      )
        invalid("Invalid Office ZIP data descriptor");
      consumed += 12;
    }
  }
  if (consumed !== start) invalid("Unowned Office ZIP data");
  const directories = new Set(
    members.filter((entry) => entry.name.endsWith("/")).map((entry) => entry.name.slice(0, -1))
  );
  for (const name of names) {
    let parent = posix.dirname(name);
    while (parent !== ".") {
      if (names.has(parent) && !directories.has(parent))
        invalid("Office ZIP file/directory collision");
      parent = posix.dirname(parent);
    }
  }
  return members;
}

function validateZipExtra(bytes: Buffer): void {
  for (let offset = 0; offset < bytes.length; ) {
    if (offset + 4 > bytes.length) invalid("Malformed Office ZIP extra metadata");
    const tag = bytes.readUInt16LE(offset);
    const length = bytes.readUInt16LE(offset + 2);
    if (offset + 4 + length > bytes.length || tag === 0x0001 || tag === 0x7075)
      invalid("Ambiguous or unsupported Office ZIP name/ZIP64 metadata");
    offset += 4 + length;
  }
}

async function validateOffice(
  bytes: Buffer,
  format: "docx" | "pptx",
  signal?: AbortSignal
): Promise<number | undefined> {
  const members = zipMembers(bytes);
  // Optional dependencies belong only to the native call path, including failure to load them.
  const { Inflate } = await import("fflate").catch((cause: unknown) => {
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "Native Office validation requires the optional dependency fflate",
      { cause }
    );
  });
  const { SaxesParser } = await import("saxes").catch((cause: unknown) => {
    throw new NativeError(
      "INVALID_CONFIGURATION",
      "Native Office validation requires the optional dependency saxes@^6",
      { cause }
    );
  });
  const parts = new Map<string, XmlPart>();
  const files = new Set(
    members.filter((member) => !member.name.endsWith("/")).map((member) => member.name)
  );
  let expandedTotal = 0;
  for (const member of members) {
    checkAbort(signal);
    const xml = /\.(xml|rels)$/i.test(member.name);
    const chunks: Buffer[] = [];
    let expanded = 0;
    let crc = 0xffffffff;
    const accept = (chunk: Uint8Array): void => {
      expanded += chunk.length;
      expandedTotal += chunk.length;
      if (
        expandedTotal > NATIVE_LIMITS.archiveBytes ||
        expanded > member.expanded ||
        (xml && expanded > NATIVE_LIMITS.xmlBytes)
      )
        invalid("Inflated Office ZIP exceeds byte limit or declared size");
      for (const byte of chunk) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 255] ?? 0);
      if (xml) chunks.push(Buffer.from(chunk));
    };
    const start =
      member.offset +
      30 +
      bytes.readUInt16LE(member.offset + 26) +
      bytes.readUInt16LE(member.offset + 28);
    const compressed = bytes.subarray(start, start + member.compressed);
    if (member.method === 0) accept(compressed);
    else {
      const inflater = new Inflate(accept);
      // A dishonest expanded-size field cannot cause a single whole-archive inflation allocation.
      for (let offset = 0; offset < compressed.length; offset += 512) {
        checkAbort(signal);
        inflater.push(compressed.subarray(offset, offset + 512), offset + 512 >= compressed.length);
        if (offset % (512 * 128) === 0) await new Promise<void>((done) => setImmediate(done));
      }
      if (compressed.length === 0) invalid("Empty deflated Office ZIP member");
    }
    if (expanded !== member.expanded || (crc ^ 0xffffffff) >>> 0 !== member.crc)
      invalid("Office ZIP size/checksum mismatch");
    if (!xml) continue;
    const part: XmlPart = {
      root: "",
      namespace: "",
      elements: new Set(),
      relationships: [],
      references: new Set(),
      slides: [],
    };
    const parser = new SaxesParser({ xmlns: true });
    const stack: string[] = [];
    const relationshipIds = new Set<string>();
    const slideIds = new Set<string>();
    let nodes = 0;
    parser.on("doctype", () => invalid("DTD/entity declarations are forbidden in Office XML"));
    parser.on("error", (error) =>
      invalid(`Malformed Office XML (${member.name}): ${error.message}`)
    );
    parser.on("opentag", (tag) => {
      if (++nodes > 1000000 || stack.length >= 256) invalid("Office XML exceeds structural limits");
      if (stack.length === 0) {
        part.root = tag.local;
        part.namespace = tag.uri;
      }
      part.elements.add(`${tag.uri}:${tag.local}`);
      if (stack.length <= 2) part.elements.add(`path:${[...stack, tag.local].join("/")}`);
      if (member.name.endsWith(".rels") && stack.length > 1)
        invalid("Office relationships contain nested elements");
      if (member.name.endsWith(".rels") && stack.length === 1) {
        if (tag.name !== "Relationship" || tag.uri !== packageNs)
          invalid("Invalid Office relationship element");
        const attr = (name: string): string => {
          const value = tag.attributes[name];
          return typeof value === "object" ? value.value : "";
        };
        const id = attr("Id");
        const type = attr("Type");
        const target = attr("Target");
        const mode = attr("TargetMode");
        if (
          !id ||
          !type ||
          !target ||
          relationshipIds.has(id) ||
          (mode && mode !== "Internal" && mode !== "External")
        )
          invalid("Invalid or duplicate Office relationship");
        // The pinned quick-xml relationship reader keeps raw attribute spellings.
        // Reject aliases it would resolve differently from the XML parser used here.
        const rawTag = text.slice(text.lastIndexOf("<", parser.position - 1), parser.position);
        const rawAttributes = new Map(
          [...rawTag.matchAll(/([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((attribute) => [
            attribute[1],
            attribute[2] ?? attribute[3],
          ])
        );
        for (const [name, value] of [
          ["Id", id],
          ["Type", type],
          ["Target", target],
        ] as const) {
          if (name === "Target" && mode === "External") continue;
          if (rawAttributes.get(name) !== value || (name === "Target" && target.includes("%")))
            invalid("Office relationship uses an unsupported encoded attribute");
        }
        relationshipIds.add(id);
        part.relationships.push({ id, type, target, external: mode === "External" });
      }
      for (const attr of Object.values(tag.attributes)) {
        if (
          typeof attr === "object" &&
          (attr.uri === officeNs || attr.uri === strictOfficeNs) &&
          ["id", "embed", "link"].includes(attr.local)
        )
          part.references.add(attr.value);
      }
      if (
        member.name === "ppt/presentation.xml" &&
        tag.local === "sldId" &&
        presentationNs.has(tag.uri)
      ) {
        if (stack.length !== 2 || stack[0] !== "presentation" || stack[1] !== "sldIdLst")
          invalid("PPTX slide is outside the presentation slide list");
        const relation = Object.values(tag.attributes).find(
          (attr) =>
            typeof attr === "object" &&
            attr.local === "id" &&
            (attr.uri === officeNs || attr.uri === strictOfficeNs)
        );
        const id = tag.attributes.id;
        if (
          !relation ||
          typeof relation !== "object" ||
          typeof id !== "object" ||
          !/^\d+$/.test(id.value) ||
          slideIds.has(id.value) ||
          part.slides.includes(relation.value)
        )
          invalid("Invalid or duplicate PPTX slide identifier");
        slideIds.add(id.value);
        part.slides.push(relation.value);
        if (part.slides.length > NATIVE_LIMITS.maxPages) invalid("PPTX exceeds slide count limit");
      }
      stack.push(tag.local);
    });
    parser.on("closetag", () => {
      stack.pop();
    });
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    if (/^\s*<\?xml[^>]*encoding\s*=\s*["'](?!utf-8["']|UTF-8["'])/i.test(text))
      invalid("Office XML must use UTF-8 encoding");
    parser.write(text).close();
    parts.set(member.name, part);
  }
  const main = format === "docx" ? "word/document.xml" : "ppt/presentation.xml";
  const mainPart = parts.get(main);
  const contentTypes = parts.get("[Content_Types].xml");
  if (
    !contentTypes ||
    contentTypes.root !== "Types" ||
    contentTypes.namespace !== "http://schemas.openxmlformats.org/package/2006/content-types"
  )
    invalid("Office package is missing valid content types");
  if (
    !mainPart ||
    mainPart.root !== (format === "docx" ? "document" : "presentation") ||
    !(format === "docx" ? wordNs : presentationNs).has(mainPart.namespace)
  )
    invalid(`Office package is missing valid ${main}`);
  if (format === "docx" && !mainPart.elements.has("path:document/body"))
    invalid("DOCX document has no body");
  const relationships = new Map<string, Map<string, Relationship>>();
  for (const [name, part] of parts) {
    if (!name.endsWith(".rels")) continue;
    if (part.root !== "Relationships" || part.namespace !== packageNs)
      invalid("Invalid Office relationships root");
    const match = /^(.*\/)?_rels\/([^/]+)\.rels$/.exec(name);
    const owner =
      name === "_rels/.rels"
        ? ""
        : match
          ? `${match[1] ?? ""}${match[2]}`
          : invalid("Invalid Office relationships location");
    if (owner && !files.has(owner)) invalid("Office relationships have no owning package part");
    const resolved = new Map<string, Relationship>();
    for (const relation of part.relationships) {
      if (relation.external) {
        if (
          relation.type !== `${officeNs}/hyperlink` &&
          relation.type !== `${strictOfficeNs}/hyperlink`
        )
          invalid("External fetchable Office relationship is forbidden");
      } else {
        relation.target = resolveTarget(owner, relation.target);
        if (!files.has(relation.target))
          invalid("Office relationship target is missing from the package");
      }
      resolved.set(relation.id, relation);
    }
    relationships.set(owner, resolved);
  }
  const root = [...(relationships.get("")?.values() ?? [])].filter(
    (relation) =>
      relation.type === `${officeNs}/officeDocument` ||
      relation.type === `${strictOfficeNs}/officeDocument`
  );
  if (root.length !== 1 || root[0]?.target !== main || root[0].external)
    invalid("Office package does not own the expected main document");
  for (const [name, part] of parts) {
    for (const id of part.references)
      if (!relationships.get(name)?.has(id)) invalid("Office XML refers to a missing relationship");
    if (
      /^ppt\/slides\/[^/]+\.xml$/.test(name) &&
      (part.root !== "sld" ||
        !presentationNs.has(part.namespace) ||
        !part.elements.has("path:sld/cSld") ||
        !part.elements.has("path:sld/cSld/spTree"))
    )
      invalid("Malformed PPTX slide XML");
  }
  if (format === "docx") return undefined;
  if (mainPart.slides.length === 0) invalid("PPTX presentation has no slides");
  const targets = new Set<string>();
  for (const id of mainPart.slides) {
    const relation = relationships.get(main)?.get(id);
    const slide = relation && parts.get(relation.target);
    if (
      !relation ||
      relation.external ||
      (relation.type !== `${officeNs}/slide` && relation.type !== `${strictOfficeNs}/slide`) ||
      !slide ||
      slide.root !== "sld" ||
      !presentationNs.has(slide.namespace) ||
      !slide.elements.has("path:sld/cSld") ||
      !slide.elements.has("path:sld/cSld/spTree") ||
      targets.has(relation.target)
    )
      invalid("PPTX presentation has a missing, duplicate or malformed slide");
    targets.add(relation.target);
  }
  return mainPart.slides.length;
}

function resolveTarget(owner: string, target: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return invalid("Invalid Office relationship URI");
  }
  if (
    decoded.includes("\\") ||
    [...decoded].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded) ||
    decoded.startsWith("//") ||
    decoded.includes("?")
  )
    invalid("Office relationship is not a package-local target");
  const path = decoded.split("#")[0] ?? "";
  const components = path.startsWith("/")
    ? []
    : owner
      ? posix
          .dirname(owner)
          .split("/")
          .filter((part) => part !== ".")
      : [];
  if (!path) return owner || invalid("Office relationship has no package target");
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!components.length) invalid("Office relationship escapes the package");
      components.pop();
    } else components.push(part);
  }
  return components.join("/");
}

/** Copy and validate an immutable, fixed-name input owned by one private conversion job. */
export async function snapshotNativeInput(
  input: string,
  inputDirectory: string,
  signal?: AbortSignal
): Promise<NativeInputSnapshot> {
  checkAbort(signal);
  if (
    typeof input !== "string" ||
    !input ||
    /^[a-z][a-z\d+.-]*:/i.test(input) ||
    input.startsWith("//") ||
    input.includes("\0")
  )
    invalid("Native input must be a local PDF, DOCX or PPTX file path");
  const extension = extname(input).slice(1).toLowerCase();
  if (extension !== "pdf" && extension !== "docx" && extension !== "pptx")
    invalid("Native input supports only PDF, DOCX and PPTX");
  const target = join(resolve(inputDirectory), `source.${extension}`);
  let created = false;
  try {
    const before = await lstat(input, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink())
      invalid("Native input must be a regular file, never a symlink");
    if (before.size === 0n || before.size > BigInt(NATIVE_LIMITS.inputBytes))
      invalid("Native input is empty or exceeds the input byte limit");
    const source = await open(
      input,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const opened = await source.stat({ bigint: true });
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size ||
        opened.mtimeNs !== before.mtimeNs ||
        opened.ctimeNs !== before.ctimeNs
      )
        invalid("Native input changed while opening");
      await mkdir(inputDirectory, { recursive: true, mode: 0o700 });
      const directory = await lstat(inputDirectory);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        invalid("Native input directory must be a private regular directory");
      const destination = await open(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      created = true;
      const chunks: Buffer[] = [];
      const hash = createHash("sha256");
      let size = 0;
      try {
        const buffer = Buffer.alloc(64 * 1024);
        for (;;) {
          checkAbort(signal);
          const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          size += bytesRead;
          if (size > NATIVE_LIMITS.inputBytes || BigInt(size) > opened.size)
            invalid("Native input grew while copying");
          const chunk = Buffer.from(buffer.subarray(0, bytesRead));
          hash.update(chunk);
          chunks.push(chunk);
          await destination.writeFile(chunk);
        }
      } finally {
        await destination.close();
      }
      const after = await source.stat({ bigint: true });
      const named = await lstat(input, { bigint: true });
      if (
        BigInt(size) !== opened.size ||
        after.size !== opened.size ||
        after.mtimeNs !== opened.mtimeNs ||
        after.ctimeNs !== opened.ctimeNs ||
        named.isSymbolicLink() ||
        named.dev !== opened.dev ||
        named.ino !== opened.ino ||
        named.mtimeNs !== opened.mtimeNs ||
        named.ctimeNs !== opened.ctimeNs
      )
        invalid("Native input changed during snapshot");
      const bytes = Buffer.concat(chunks);
      let expectedPages: number | undefined;
      if (extension === "pdf") {
        if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n|\s)/.test(bytes.subarray(0, 12).toString("latin1")))
          invalid("Native PDF input has an unknown magic header");
      } else {
        if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)
          invalid("Native Office input has an unknown ZIP magic header");
        expectedPages = await validateOffice(bytes, extension, signal);
      }
      checkAbort(signal);
      return {
        path: target,
        filename: basename(input),
        format: extension,
        size,
        sha256: hash.digest("hex"),
        ...(expectedPages === undefined ? {} : { expectedPages }),
      };
    } finally {
      await source.close();
    }
  } catch (cause) {
    if (created) await unlink(target).catch(() => undefined);
    if (cause instanceof NativeError) throw cause;
    throw new NativeError("INVALID_INPUT", "Unable to snapshot or validate native input", {
      cause,
    });
  }
}
