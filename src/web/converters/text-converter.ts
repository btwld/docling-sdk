/**
 * DocTags to Plain Text Converter
 *
 * Converts Docling XML markup (DocTags) to clean plain text.
 * Ported from web-ocr/packages/docling-client/src/text-converter.ts
 */

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

      switch (tag) {
        case "lcel":
        case "ucel":
        case "xcel":
          cells.push("");
          break;
        default:
          cells.push(cellContent);
          break;
      }
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

  for (let match = inlineTagRegex.exec(content); match !== null; match = inlineTagRegex.exec(content)) {
    const textBefore = content.slice(lastIndex, match.index);
    result += cleanContent(textBefore);

    const [, , innerContent] = match;
    result += cleanContent(innerContent ?? "");

    lastIndex = match.index + match[0].length;
  }

  result += cleanContent(content.slice(lastIndex));
  return result;
}

function processTag(tagName: string, content: string): string {
  const clean = cleanContent(content);

  switch (tagName) {
    case "doctag":
    case "document":
      return convertDocTags(content);

    case "title":
      return `${clean}\n${"=".repeat(Math.min(clean.length, 50))}\n\n`;

    case "section_header_level_0":
    case "section_header_level_1":
    case "section_header_level_2":
    case "section_header_level_3":
    case "section_header_level_4":
    case "section_header_level_5":
      return `${clean}\n${"-".repeat(Math.min(clean.length, 40))}\n\n`;

    case "text":
    case "paragraph":
      return `${clean}\n\n`;

    case "code": {
      const codeContent = cleanContent(content.replace(/<_[^_]+_>/, "")).trim();
      const indentedCode = codeContent
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
      return `${indentedCode}\n\n`;
    }

    case "formula":
      return `${clean}\n\n`;

    case "otsl":
      return `${parseTableToText(content)}\n\n`;

    case "picture":
    case "chart": {
      const captionMatch = content.match(/<caption>([\s\S]*?)<\/caption>/);
      const caption = captionMatch ? cleanContent(captionMatch[1] ?? "") : `[${tagName}]`;
      return `[${caption}]\n\n`;
    }

    case "ordered_list": {
      const items: string[] = [];
      const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
      let index = 1;
      for (let match = listItemRegex.exec(content); match !== null; match = listItemRegex.exec(content)) {
        const itemContent = cleanContent(match[1] ?? "").replace(/^[·\-]\s*/, "").trim();
        items.push(`${index}. ${itemContent}`);
        index++;
      }
      return `${items.join("\n")}\n\n`;
    }

    case "unordered_list": {
      const items: string[] = [];
      const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
      for (let match = listItemRegex.exec(content); match !== null; match = listItemRegex.exec(content)) {
        const itemContent = cleanContent(match[1] ?? "").replace(/^[·\-]\s*/, "").trim();
        items.push(`* ${itemContent}`);
      }
      return `${items.join("\n")}\n\n`;
    }

    case "list_item": {
      const itemContent = clean.replace(/^[·\-]\s*/, "").trim();
      return `* ${itemContent}\n`;
    }

    case "caption":
      return `[${clean}]\n\n`;

    case "footnote":
      return `[Note: ${clean}]\n\n`;

    case "page_header":
    case "page_footer":
      return "";

    case "page_break":
      return `\n${"─".repeat(40)}\n\n`;

    case "checkbox_selected":
      return "[X] ";

    case "checkbox_unselected":
      return "[ ] ";

    case "inline":
      return processInlineContent(content);

    case "reference":
      return clean;

    case "smiles":
      return clean;

    default:
      if (clean) {
        return `${clean}\n\n`;
      }
      return "";
  }
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
