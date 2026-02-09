/**
 * DocTags to Markdown Converter
 *
 * Converts Docling XML markup (DocTags) to GitHub Flavored Markdown.
 * Ported from web-ocr/packages/docling-client/src/markdown-converter.ts
 */

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

function processInlineContent(content: string): string {
  const inlineTagRegex = /<(code|formula|text|smiles)>([\s\S]*?)<\/\1>/g;
  let result = "";
  let lastIndex = 0;

  for (let match = inlineTagRegex.exec(content); match !== null; match = inlineTagRegex.exec(content)) {
    const textBefore = content.slice(lastIndex, match.index);
    result += cleanLocationTokens(textBefore);

    const [, tagName, innerContent] = match;
    const cleanInner = cleanLocationTokens(innerContent ?? "");

    switch (tagName) {
      case "code":
        result += `\`${cleanInner}\``;
        break;
      case "formula":
        result += `$${cleanInner}$`;
        break;
      case "smiles":
        result += `\`${cleanInner}\``;
        break;
      default:
        result += cleanInner;
        break;
    }

    lastIndex = match.index + match[0].length;
  }

  result += cleanLocationTokens(content.slice(lastIndex));
  return result;
}

function processTag(tagName: string, content: string): string {
  const cleanContent = cleanLocationTokens(content);

  switch (tagName) {
    case "doctag":
    case "document":
      return convertDocTags(content);

    case "title":
      return `# ${cleanContent}\n\n`;

    case "section_header_level_0":
      return `## ${cleanContent}\n\n`;

    case "section_header_level_1":
      return `### ${cleanContent}\n\n`;

    case "section_header_level_2":
      return `#### ${cleanContent}\n\n`;

    case "section_header_level_3":
      return `##### ${cleanContent}\n\n`;

    case "section_header_level_4":
    case "section_header_level_5":
      return `###### ${cleanContent}\n\n`;

    case "text":
    case "paragraph":
      return `${cleanContent}\n\n`;

    case "code": {
      const langMatch = content.match(/<_([^_]+)_>/);
      const language = langMatch ? langMatch[1] : "";
      const codeContent = cleanLocationTokens(content.replace(/<_[^_]+_>/, "")).trim();
      return `\`\`\`${language}\n${codeContent}\n\`\`\`\n\n`;
    }

    case "formula": {
      const formulaText = cleanContent;
      if (formulaText.includes("\n") || formulaText.length > 50) {
        return `$$\n${formulaText}\n$$\n\n`;
      }
      return `$${formulaText}$\n\n`;
    }

    case "otsl":
      return `${parseTableToMarkdown(content)}\n\n`;

    case "picture":
    case "chart": {
      const captionMatch = content.match(/<caption>([\s\S]*?)<\/caption>/);
      const caption = captionMatch ? cleanLocationTokens(captionMatch[1] ?? "") : tagName;
      return `![${caption}]()\n\n`;
    }

    case "ordered_list": {
      const items: string[] = [];
      const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
      let index = 1;
      for (let match = listItemRegex.exec(content); match !== null; match = listItemRegex.exec(content)) {
        const itemContent = cleanLocationTokens(match[1] ?? "").replace(/^[·\-]\s*/, "").trim();
        items.push(`${index}. ${itemContent}`);
        index++;
      }
      return `${items.join("\n")}\n\n`;
    }

    case "unordered_list": {
      const items: string[] = [];
      const listItemRegex = /<list_item>([\s\S]*?)<\/list_item>/g;
      for (let match = listItemRegex.exec(content); match !== null; match = listItemRegex.exec(content)) {
        const itemContent = cleanLocationTokens(match[1] ?? "").replace(/^[·\-]\s*/, "").trim();
        items.push(`- ${itemContent}`);
      }
      return `${items.join("\n")}\n\n`;
    }

    case "list_item": {
      const itemContent = cleanContent.replace(/^[·\-]\s*/, "").trim();
      return `- ${itemContent}\n`;
    }

    case "caption":
      return `*${cleanContent}*\n\n`;

    case "footnote":
      return `[^note]: ${cleanContent}\n\n`;

    case "page_header":
    case "page_footer":
      return "";

    case "page_break":
      return "\n---\n\n";

    case "checkbox_selected":
      return "- [x] ";

    case "checkbox_unselected":
      return "- [ ] ";

    case "inline":
      return processInlineContent(content);

    default:
      if (cleanContent) {
        return `${cleanContent}\n\n`;
      }
      return "";
  }
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
