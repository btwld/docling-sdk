/**
 * DocTags to Plain Text Converter
 *
 * Converts Docling XML markup (DocTags) to clean plain text.
 * Ported from web-ocr/packages/docling-client/src/text-converter.ts
 */

const EMPTY_CELL_TAGS = new Set(["lcel", "ucel", "xcel"]);

function cleanContent(content: string): string {
  return content.replace(/<loc_\d+>/g, "").trim();
}

function parseTableToText(content: string): string {
  const rows = content
    .trim()
    .split(/<nl>/)
    .filter((row) => row.length > 0);

  if (rows.length === 0) return "";

  const cellTagRegex = /<(ched|rhed|srow|fcel|ecel|ucel|lcel|xcel)>/g;
  const textRows: string[][] = [];
  let maxCols = 0;

  for (const rowStr of rows) {
    const cells: string[] = [];
    const parts = rowStr.split(cellTagRegex);

    for (let i = 1; i < parts.length; i += 2) {
      const tag = parts[i];
      const cellContent = cleanContent(parts[i + 1] ?? "");

      cells.push(EMPTY_CELL_TAGS.has(tag ?? "") ? "" : cellContent);
    }

    maxCols = Math.max(maxCols, cells.length);
    textRows.push(cells);
  }

  if (textRows.length === 0 || maxCols === 0) return "";

  for (const row of textRows) {
    while (row.length < maxCols) {
      row.push("");
    }
  }

  return textRows.map((row) => row.join("\t")).join("\n");
}

function processInlineContent(content: string): string {
  const inlineTagRegex = /<(code|formula|text|smiles)>([\s\S]*?)<\/\1>/g;
  let result = "";
  let lastIndex = 0;

  for (
    let match = inlineTagRegex.exec(content);
    match !== null;
    match = inlineTagRegex.exec(content)
  ) {
    const textBefore = content.slice(lastIndex, match.index);
    result += cleanContent(textBefore);

    const [, , innerContent] = match;
    result += cleanContent(innerContent ?? "");

    lastIndex = match.index + match[0].length;
  }

  result += cleanContent(content.slice(lastIndex));
  return result;
}

type TagHandler = (tagName: string, content: string, clean: string) => string;

function handleTextCode(_t: string, content: string): string {
  const codeContent = cleanContent(content.replace(/<_[^_]+_>/, "")).trim();
  const indentedCode = codeContent
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `${indentedCode}\n\n`;
}

function handleTextOrderedList(_t: string, content: string): string {
  const items: string[] = [];
  const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
  let index = 1;
  for (
    let match = listItemRegex.exec(content);
    match !== null;
    match = listItemRegex.exec(content)
  ) {
    const itemContent = cleanContent(match[1] ?? "")
      .replace(/^[·\-]\s*/, "")
      .trim();
    items.push(`${index}. ${itemContent}`);
    index++;
  }
  return `${items.join("\n")}\n\n`;
}

function handleTextUnorderedList(_t: string, content: string): string {
  const items: string[] = [];
  const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
  for (
    let match = listItemRegex.exec(content);
    match !== null;
    match = listItemRegex.exec(content)
  ) {
    const itemContent = cleanContent(match[1] ?? "")
      .replace(/^[·\-]\s*/, "")
      .trim();
    items.push(`* ${itemContent}`);
  }
  return `${items.join("\n")}\n\n`;
}

function handleTextPictureOrChart(tagName: string, content: string): string {
  const captionMatch = content.match(/<caption>([\s\S]*?)<\/caption>/);
  const caption = captionMatch ? cleanContent(captionMatch[1] ?? "") : `[${tagName}]`;
  return `[${caption}]\n\n`;
}

const sectionHeader: TagHandler = (_t, _c, clean) =>
  `${clean}\n${"-".repeat(Math.min(clean.length, 40))}\n\n`;

const textOrParagraph: TagHandler = (_t, _c, clean) => `${clean}\n\n`;

const TEXT_TAG_HANDLERS: Record<string, TagHandler> = {
  doctag: (_t, content) => convertDocTags(content),
  document: (_t, content) => convertDocTags(content),
  title: (_t, _c, clean) => `${clean}\n${"=".repeat(Math.min(clean.length, 50))}\n\n`,
  section_header_level_0: sectionHeader,
  section_header_level_1: sectionHeader,
  section_header_level_2: sectionHeader,
  section_header_level_3: sectionHeader,
  section_header_level_4: sectionHeader,
  section_header_level_5: sectionHeader,
  text: textOrParagraph,
  paragraph: textOrParagraph,
  code: handleTextCode,
  formula: (_t, _c, clean) => `${clean}\n\n`,
  otsl: (_t, content) => `${parseTableToText(content)}\n\n`,
  picture: handleTextPictureOrChart,
  chart: handleTextPictureOrChart,
  ordered_list: handleTextOrderedList,
  unordered_list: handleTextUnorderedList,
  list_item: (_t, _c, clean) => `* ${clean.replace(/^[·\-]\s*/, "").trim()}\n`,
  caption: (_t, _c, clean) => `[${clean}]\n\n`,
  footnote: (_t, _c, clean) => `[Note: ${clean}]\n\n`,
  page_header: () => "",
  page_footer: () => "",
  page_break: () => `\n${"─".repeat(40)}\n\n`,
  checkbox_selected: () => "[X] ",
  checkbox_unselected: () => "[ ] ",
  inline: (_t, content) => processInlineContent(content),
  reference: (_t, _c, clean) => clean,
  smiles: (_t, _c, clean) => clean,
};

function processTag(tagName: string, content: string): string {
  const clean = cleanContent(content);
  const handler = TEXT_TAG_HANDLERS[tagName];
  if (handler) {
    return handler(tagName, content, clean);
  }
  return clean ? `${clean}\n\n` : "";
}

function convertDocTags(input: string): string {
  let text = "";
  let remaining = input;

  const tagRegex = /<([a-z_0-9]+)>([\s\S]*?)<\/\1>/;

  while (remaining.length > 0) {
    const match = remaining.match(tagRegex);

    if (match && match.index !== undefined) {
      const textBefore = remaining.slice(0, match.index);
      const cleanText = cleanContent(textBefore);
      if (cleanText.trim()) {
        text += `${cleanText}\n\n`;
      }

      text += processTag(match[1] ?? "", match[2] ?? "");
      remaining = remaining.slice(match.index + match[0].length);
    } else {
      const cleanText = cleanContent(remaining);
      if (cleanText.trim()) {
        text += `${cleanText}\n\n`;
      }
      break;
    }
  }

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Convert DocTags markup to Plain Text
 */
export function doclingToPlainText(doctags: string): string {
  return convertDocTags(doctags);
}
