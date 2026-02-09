/**
 * DocTags to Markdown Converter
 *
 * Converts Docling XML markup (DocTags) to GitHub Flavored Markdown.
 * Ported from web-ocr/packages/docling-client/src/markdown-converter.ts
 */

const EMPTY_CELL_TAGS = new Set(["lcel", "ucel", "xcel"]);

function cleanLocationTokens(content: string): string {
  return content.replace(/<loc_\d+>/g, "").trim();
}

function parseTableToMarkdown(content: string): string {
  const rows = content
    .trim()
    .split(/<nl>/)
    .filter((row) => row.length > 0);

  if (rows.length === 0) return "";

  const cellTagRegex = /<(ched|rhed|srow|fcel|ecel|ucel|lcel|xcel)>/g;
  const tableRows: string[][] = [];
  let maxCols = 0;

  for (const rowStr of rows) {
    const cells: string[] = [];
    const parts = rowStr.split(cellTagRegex);

    for (let i = 1; i < parts.length; i += 2) {
      const tag = parts[i];
      const cellContent = cleanLocationTokens(parts[i + 1] ?? "");

      cells.push(EMPTY_CELL_TAGS.has(tag ?? "") ? "" : cellContent);
    }

    maxCols = Math.max(maxCols, cells.length);
    tableRows.push(cells);
  }

  if (tableRows.length === 0 || maxCols === 0) return "";

  for (const row of tableRows) {
    while (row.length < maxCols) {
      row.push("");
    }
  }

  const lines: string[] = [];

  const headerRow = tableRows[0] ?? [];
  lines.push(`| ${headerRow.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`);
  lines.push(`| ${headerRow.map(() => "---").join(" | ")} |`);

  for (let i = 1; i < tableRows.length; i++) {
    const row = tableRows[i] ?? [];
    lines.push(`| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`);
  }

  return lines.join("\n");
}

const INLINE_HANDLERS: Record<string, (content: string) => string> = {
  code: (c) => `\`${c}\``,
  formula: (c) => `$${c}$`,
  smiles: (c) => `\`${c}\``,
  text: (c) => c,
};

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
    result += cleanLocationTokens(textBefore);

    const [, tagName, innerContent] = match;
    const cleanInner = cleanLocationTokens(innerContent ?? "");
    const handler = INLINE_HANDLERS[tagName ?? ""];
    result += handler ? handler(cleanInner) : cleanInner;

    lastIndex = match.index + match[0].length;
  }

  result += cleanLocationTokens(content.slice(lastIndex));
  return result;
}

type TagHandler = (tagName: string, content: string, cleanContent: string) => string;

function handleMarkdownCode(_t: string, content: string): string {
  const langMatch = content.match(/<_([^_]+)_>/);
  const language = langMatch ? langMatch[1] : "";
  const codeContent = cleanLocationTokens(content.replace(/<_[^_]+_>/, "")).trim();
  return `\`\`\`${language}\n${codeContent}\n\`\`\`\n\n`;
}

function handleMarkdownFormula(_t: string, _c: string, clean: string): string {
  if (clean.includes("\n") || clean.length > 50) {
    return `$$\n${clean}\n$$\n\n`;
  }
  return `$${clean}$\n\n`;
}

function handleMarkdownOrderedList(_t: string, content: string): string {
  const items: string[] = [];
  const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
  let index = 1;
  for (
    let match = listItemRegex.exec(content);
    match !== null;
    match = listItemRegex.exec(content)
  ) {
    const itemContent = cleanLocationTokens(match[1] ?? "")
      .replace(/^[·\-]\s*/, "")
      .trim();
    items.push(`${index}. ${itemContent}`);
    index++;
  }
  return `${items.join("\n")}\n\n`;
}

function handleMarkdownUnorderedList(_t: string, content: string): string {
  const items: string[] = [];
  const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
  for (
    let match = listItemRegex.exec(content);
    match !== null;
    match = listItemRegex.exec(content)
  ) {
    const itemContent = cleanLocationTokens(match[1] ?? "")
      .replace(/^[·\-]\s*/, "")
      .trim();
    items.push(`- ${itemContent}`);
  }
  return `${items.join("\n")}\n\n`;
}

function handleMarkdownPictureOrChart(tagName: string, content: string): string {
  const captionMatch = content.match(/<caption>([\s\S]*?)<\/caption>/);
  const caption = captionMatch ? cleanLocationTokens(captionMatch[1] ?? "") : tagName;
  return `![${caption}]()\n\n`;
}

const textOrParagraph: TagHandler = (_t, _c, clean) => `${clean}\n\n`;

const MARKDOWN_TAG_HANDLERS: Record<string, TagHandler> = {
  doctag: (_t, content) => convertDocTags(content),
  document: (_t, content) => convertDocTags(content),
  title: (_t, _c, clean) => `# ${clean}\n\n`,
  section_header_level_0: (_t, _c, clean) => `## ${clean}\n\n`,
  section_header_level_1: (_t, _c, clean) => `### ${clean}\n\n`,
  section_header_level_2: (_t, _c, clean) => `#### ${clean}\n\n`,
  section_header_level_3: (_t, _c, clean) => `##### ${clean}\n\n`,
  section_header_level_4: (_t, _c, clean) => `###### ${clean}\n\n`,
  section_header_level_5: (_t, _c, clean) => `###### ${clean}\n\n`,
  text: textOrParagraph,
  paragraph: textOrParagraph,
  code: handleMarkdownCode,
  formula: handleMarkdownFormula,
  otsl: (_t, content) => `${parseTableToMarkdown(content)}\n\n`,
  picture: handleMarkdownPictureOrChart,
  chart: handleMarkdownPictureOrChart,
  ordered_list: handleMarkdownOrderedList,
  unordered_list: handleMarkdownUnorderedList,
  list_item: (_t, _c, clean) => `- ${clean.replace(/^[·\-]\s*/, "").trim()}\n`,
  caption: (_t, _c, clean) => `*${clean}*\n\n`,
  footnote: (_t, _c, clean) => `[^note]: ${clean}\n\n`,
  page_header: () => "",
  page_footer: () => "",
  page_break: () => "\n---\n\n",
  checkbox_selected: () => "- [x] ",
  checkbox_unselected: () => "- [ ] ",
  inline: (_t, content) => processInlineContent(content),
};

function processTag(tagName: string, content: string): string {
  const cleanContent = cleanLocationTokens(content);
  const handler = MARKDOWN_TAG_HANDLERS[tagName];
  if (handler) {
    return handler(tagName, content, cleanContent);
  }
  return cleanContent ? `${cleanContent}\n\n` : "";
}

function convertDocTags(input: string): string {
  let markdown = "";
  let remaining = input;

  const tagRegex = /<([a-z_0-9]+)>([\s\S]*?)<\/\1>/;

  while (remaining.length > 0) {
    const match = remaining.match(tagRegex);

    if (match && match.index !== undefined) {
      const textBefore = remaining.slice(0, match.index);
      const cleanText = cleanLocationTokens(textBefore);
      if (cleanText.trim()) {
        markdown += `${cleanText}\n\n`;
      }

      markdown += processTag(match[1] ?? "", match[2] ?? "");
      remaining = remaining.slice(match.index + match[0].length);
    } else {
      const cleanText = cleanLocationTokens(remaining);
      if (cleanText.trim()) {
        markdown += `${cleanText}\n\n`;
      }
      break;
    }
  }

  return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Convert DocTags markup to Markdown
 */
export function doclingToMarkdown(doctags: string): string {
  return convertDocTags(doctags);
}
