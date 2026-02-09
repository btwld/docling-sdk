/**
 * DocTags to DoclingDocument JSON Converter
 *
 * Converts Docling XML markup (DocTags) to WebOCRDocument JSON format.
 * Ported from web-ocr/packages/docling-client/src/json-converter.ts
 */

import type {
  WebOCRBoundingBox,
  WebOCRContentItem,
  WebOCRDocument,
  WebOCRGroupItem,
  WebOCRPictureItem,
  WebOCRProvenanceItem,
  WebOCRTableCell,
  WebOCRTableData,
  WebOCRTableItem,
  WebOCRTextItem,
} from "../../types/web";

let refCounter = 0;

function generateRef(): string {
  return `#/texts/${refCounter++}`;
}

function resetRefCounter(): void {
  refCounter = 0;
}

function parseLocationToken(content: string): {
  bbox: WebOCRBoundingBox | null;
  cleanContent: string;
} {
  const locRegex = /<loc_(\d+)>/g;
  const matches = [...content.matchAll(locRegex)];
  const cleanContent = content.replace(locRegex, "").trim();

  if (matches.length >= 4) {
    const coords = matches.slice(0, 4).map((m) => Number.parseInt(m[1] ?? "0", 10) / 1000);
    return {
      bbox: {
        l: coords[0] ?? 0,
        t: coords[1] ?? 0,
        r: coords[2] ?? 0,
        b: coords[3] ?? 0,
        coord_origin: "TOPLEFT",
      },
      cleanContent,
    };
  }

  return { bbox: null, cleanContent };
}

function createProvenance(bbox: WebOCRBoundingBox | null, pageNo = 1): WebOCRProvenanceItem[] {
  if (!bbox) return [];
  return [
    {
      page_no: pageNo,
      bbox,
      charspan: [0, 0],
    },
  ];
}

function parseTableContent(content: string): WebOCRTableData {
  const rows = content
    .trim()
    .split(/<nl>/)
    .filter((row) => row.length > 0);

  const grid: WebOCRTableCell[][] = [];
  let numCols = 0;

  const cellTagRegex = /<(ched|rhed|srow|fcel|ecel|ucel|lcel|xcel)>/g;

  rows.forEach((rowStr, rowIndex) => {
    const cells: WebOCRTableCell[] = [];
    let colIndex = 0;

    const parts = rowStr.split(cellTagRegex);

    for (let i = 1; i < parts.length; i += 2) {
      const tag = parts[i];
      const cellContent = (parts[i + 1] ?? "").trim();

      const isHeader = tag === "ched" || tag === "rhed" || tag === "srow";

      switch (tag) {
        case "lcel": {
          const lastCell = cells[cells.length - 1];
          if (lastCell) {
            lastCell.col_span = (lastCell.col_span || 1) + 1;
          }
          colIndex++;
          break;
        }
        case "ucel": {
          const prevRowCell = grid[rowIndex - 1]?.[colIndex];
          if (rowIndex > 0 && prevRowCell) {
            prevRowCell.row_span = (prevRowCell.row_span || 1) + 1;
          }
          colIndex++;
          break;
        }
        case "xcel":
          colIndex++;
          break;
        default:
          cells.push({
            text: cellContent,
            row_span: 1,
            col_span: 1,
            start_row_offset_idx: rowIndex,
            end_row_offset_idx: rowIndex + 1,
            start_col_offset_idx: colIndex,
            end_col_offset_idx: colIndex + 1,
            col_header: isHeader && tag === "ched",
            row_header: isHeader && (tag === "rhed" || tag === "srow"),
          });
          colIndex++;
          break;
      }
    }

    numCols = Math.max(numCols, colIndex);
    grid.push(cells);
  });

  return {
    num_rows: grid.length,
    num_cols: numCols,
    table_cells: grid.flat(),
  };
}

interface ParsedTag {
  tagName: string;
  content: string;
  fullMatch: string;
}

function parseNextTag(input: string): ParsedTag | null {
  const pairedRegex = /<([a-z_0-9]+)>([\s\S]*?)<\/\1>/;
  const match = input.match(pairedRegex);

  if (match) {
    return {
      tagName: match[1] ?? "",
      content: match[2] ?? "",
      fullMatch: match[0],
    };
  }

  return null;
}

interface JsonTagContext {
  tag: ParsedTag;
  cleanContent: string;
  prov: WebOCRProvenanceItem[];
  texts: WebOCRTextItem[];
  tables: WebOCRTableItem[];
  pictures: WebOCRPictureItem[];
  bodyChildren: WebOCRContentItem[];
}

function pushTextItem(
  ctx: JsonTagContext,
  label: WebOCRTextItem["label"],
  overrides?: Partial<WebOCRTextItem>
): void {
  const ref = generateRef();
  const item: WebOCRTextItem = {
    self_ref: ref,
    parent: { $ref: "#/body" },
    children: [],
    label,
    prov: ctx.prov,
    orig: ctx.cleanContent,
    text: ctx.cleanContent,
    ...overrides,
  };
  ctx.texts.push(item);
  ctx.bodyChildren.push({ $ref: ref });
}

function handleJsonSectionHeader(ctx: JsonTagContext): void {
  const level = Number.parseInt(ctx.tag.tagName.slice(-1), 10) + 1;
  pushTextItem(ctx, "section_header", { level });
}

function handleJsonLabeledText(ctx: JsonTagContext): void {
  pushTextItem(ctx, ctx.tag.tagName as WebOCRTextItem["label"]);
}

function handleJsonPicture(ctx: JsonTagContext): void {
  const captionMatch = ctx.tag.content.match(/<caption>([\s\S]*?)<\/caption>/);
  const caption = captionMatch ? captionMatch[1]?.replace(/<loc_\d+>/g, "").trim() : undefined;

  const ref = `#/pictures/${ctx.pictures.length}`;
  const item: WebOCRPictureItem = {
    self_ref: ref,
    parent: { $ref: "#/body" },
    children: [],
    label: ctx.tag.tagName === "chart" ? "chart" : "picture",
    prov: ctx.prov,
    caption,
  };
  ctx.pictures.push(item);
  ctx.bodyChildren.push({ $ref: ref });
}

function handleJsonList(ctx: JsonTagContext): void {
  const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
  for (
    let listMatch = listItemRegex.exec(ctx.tag.content);
    listMatch !== null;
    listMatch = listItemRegex.exec(ctx.tag.content)
  ) {
    const { cleanContent: listItemContent } = parseLocationToken(listMatch[1] ?? "");
    const itemText = listItemContent.replace(/^[·\-]\s*/, "").trim();
    const ref = generateRef();
    const item: WebOCRTextItem = {
      self_ref: ref,
      parent: { $ref: "#/body" },
      children: [],
      label: "list_item",
      prov: [],
      orig: itemText,
      text: itemText,
      enumerated: ctx.tag.tagName === "ordered_list",
    };
    ctx.texts.push(item);
    ctx.bodyChildren.push({ $ref: ref });
  }
}

const JSON_TAG_HANDLERS: Record<string, (ctx: JsonTagContext) => void> = {
  doctag: (ctx) =>
    processDocTags(ctx.tag.content, ctx.texts, ctx.tables, ctx.pictures, ctx.bodyChildren),
  document: (ctx) =>
    processDocTags(ctx.tag.content, ctx.texts, ctx.tables, ctx.pictures, ctx.bodyChildren),
  title: (ctx) => pushTextItem(ctx, "title"),
  section_header_level_0: handleJsonSectionHeader,
  section_header_level_1: handleJsonSectionHeader,
  section_header_level_2: handleJsonSectionHeader,
  section_header_level_3: handleJsonSectionHeader,
  section_header_level_4: handleJsonSectionHeader,
  section_header_level_5: handleJsonSectionHeader,
  text: (ctx) => pushTextItem(ctx, "text"),
  paragraph: (ctx) => pushTextItem(ctx, "text"),
  code: (ctx) => {
    const langMatch = ctx.cleanContent.match(/<_([^_]+)_>/);
    const language = langMatch ? langMatch[1] : undefined;
    const codeText = ctx.cleanContent.replace(/<_[^_]+_>/, "").trim();
    pushTextItem(ctx, "code", { orig: codeText, text: codeText, language });
  },
  formula: (ctx) => pushTextItem(ctx, "formula"),
  otsl: (ctx) => {
    const tableData = parseTableContent(ctx.tag.content);
    const ref = `#/tables/${ctx.tables.length}`;
    const item: WebOCRTableItem = {
      self_ref: ref,
      parent: { $ref: "#/body" },
      children: [],
      label: "table",
      prov: ctx.prov,
      data: tableData,
    };
    ctx.tables.push(item);
    ctx.bodyChildren.push({ $ref: ref });
  },
  picture: handleJsonPicture,
  chart: handleJsonPicture,
  ordered_list: handleJsonList,
  unordered_list: handleJsonList,
  caption: handleJsonLabeledText,
  footnote: handleJsonLabeledText,
  page_header: handleJsonLabeledText,
  page_footer: handleJsonLabeledText,
};

function processDocTags(
  doctags: string,
  texts: WebOCRTextItem[],
  tables: WebOCRTableItem[],
  pictures: WebOCRPictureItem[],
  bodyChildren: WebOCRContentItem[]
): void {
  let remaining = doctags;

  while (remaining.length > 0) {
    const tag = parseNextTag(remaining);

    if (!tag) {
      break;
    }

    const tagIndex = remaining.indexOf(tag.fullMatch);
    remaining = remaining.slice(tagIndex + tag.fullMatch.length);

    const { bbox, cleanContent } = parseLocationToken(tag.content);
    const prov = createProvenance(bbox);
    const ctx: JsonTagContext = { tag, cleanContent, prov, texts, tables, pictures, bodyChildren };

    const handler = JSON_TAG_HANDLERS[tag.tagName];
    if (handler) {
      handler(ctx);
    } else if (cleanContent?.trim()) {
      pushTextItem(ctx, "text");
    }
  }
}

/**
 * Convert DocTags markup to WebOCRDocument JSON format
 */
export function doclingToJson(doctags: string, documentName = "document"): WebOCRDocument {
  resetRefCounter();

  const texts: WebOCRTextItem[] = [];
  const tables: WebOCRTableItem[] = [];
  const pictures: WebOCRPictureItem[] = [];
  const bodyChildren: WebOCRContentItem[] = [];

  processDocTags(doctags, texts, tables, pictures, bodyChildren);

  const body: WebOCRGroupItem = {
    self_ref: "#/body",
    parent: null,
    children: bodyChildren,
    label: "body",
  };

  const pages: Record<number, { size: { width: number; height: number } }> = {
    1: {
      size: {
        width: 612,
        height: 792,
      },
    },
  };

  return {
    schema_name: "DoclingDocument",
    version: "1.0.0",
    name: documentName,
    texts,
    tables,
    pictures,
    body,
    pages,
  };
}
