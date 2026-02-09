/**
 * DoclingConverter - Converts Docling XML markup to HTML
 *
 * Ported from web-ocr/packages/docling-client/src/parser.ts
 */
export class DoclingConverter {
  private simpleTagMap: Record<string, string>;
  private selfClosingTagMap: Record<string, string>;
  private TABLE_TAG_CONFIG: Record<string, { htmlTag: string; scope?: string }>;
  private TABLE_TAG_REGEX: RegExp;
  private combinedTagRegex: RegExp;

  constructor() {
    this.simpleTagMap = {
      doctag: "div",
      document: "div",
      ordered_list: "ol",
      unordered_list: "ul",
      list_item: "li",
      caption: "figcaption",
      footnote: "sup",
      formula: "div",
      page_footer: "footer",
      page_header: "header",
      picture: "figure",
      chart: "figure",
      table: "table",
      otsl: "table",
      text: "p",
      paragraph: "p",
      title: "h1",
      document_index: "div",
      form: "form",
      key_value_region: "dl",
      reference: "a",
      smiles: "span",
    };

    this.selfClosingTagMap = {
      checkbox_selected: '<input type="checkbox" checked disabled>',
      checkbox_unselected: '<input type="checkbox" disabled>',
      page_break: '<hr class="page-break">',
    };

    this.TABLE_TAG_CONFIG = {
      "<ched>": { htmlTag: "th" },
      "<rhed>": { htmlTag: "th", scope: "row" },
      "<srow>": { htmlTag: "th", scope: "row" },
      "<fcel>": { htmlTag: "td" },
      "<ecel>": { htmlTag: "td" },
      "<ucel>": { htmlTag: "td" },
      "<lcel>": { htmlTag: "td" },
      "<xcel>": { htmlTag: "td" },
    };

    this.TABLE_TAG_REGEX = new RegExp(
      `(${Object.keys(this.TABLE_TAG_CONFIG).join("|")})`
    );

    const selfClosingNames = Object.keys(this.selfClosingTagMap).join("|");
    this.combinedTagRegex = new RegExp(
      `(<([a-z_0-9]+)>(.*?)<\\/\\2>)|(<(${selfClosingNames})>)`,
      "s"
    );
  }

  private escapeHtml(text: string): string {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  convert(docling: string): string {
    let html = ` ${docling} `;
    html = this.cleanupMetadataTokens(html);
    html = this.processTags(html);
    return html.trim();
  }

  private processTags(text: string): string {
    let remainingText = text;
    let result = "";

    while (remainingText.length > 0) {
      const match = remainingText.match(this.combinedTagRegex);

      if (match && typeof match.index === "number") {
        const textBefore = remainingText.substring(0, match.index);
        result += this.escapeHtml(textBefore);

        const fullMatch = match[0];
        const pairedTagName = match[2];
        const pairedContent = match[3];
        const selfClosingTagName = match[5];

        if (pairedTagName !== undefined) {
          result += this.convertSingleTag(pairedTagName, pairedContent ?? "");
        } else if (selfClosingTagName !== undefined) {
          result += this.selfClosingTagMap[selfClosingTagName] ?? "";
        }

        remainingText = remainingText.substring(match.index + fullMatch.length);
      } else {
        result += this.escapeHtml(remainingText);
        break;
      }
    }

    return result;
  }

  private convertSingleTag(tagName: string, rawContent: string): string {
    const content = tagName === "list_item"
      ? rawContent.trim().replace(/^[·-]\s*/g, "")
      : rawContent;

    switch (tagName) {
      case "code":
        return this.convertBlockCode(content);
      case "otsl":
        return this.convertTable(content);
      case "picture":
      case "chart":
        return this.convertPictureOrChart(tagName, content);
      case "inline":
        return this.convertInlineContent(content);
      case "section_header_level_0":
      case "section_header_level_1":
      case "section_header_level_2":
      case "section_header_level_3":
      case "section_header_level_4":
      case "section_header_level_5": {
        const level = Number.parseInt(tagName.at(-1) ?? "0", 10) + 1;
        return `<h${level}>${this.processTags(content)}</h${level}>`;
      }
      default: {
        const htmlTag = this.simpleTagMap[tagName];
        if (htmlTag) {
          const processedContent = this.processTags(content);
          const startTag = this.getStartTag(tagName, htmlTag);
          return `${startTag}${processedContent}</${htmlTag}>`;
        }
        console.warn(`Unknown tag encountered: ${tagName}, escaping it.`);
        return this.escapeHtml(`<${tagName}>${content}</${tagName}>`);
      }
    }
  }

  private getStartTag(doclingTag: string, htmlTag: string): string {
    switch (doclingTag) {
      case "doctag":
      case "document":
        return '<div class="docling-document">';
      case "formula":
        return '<div class="formula">';
      case "document_index":
        return '<div class="toc">';
      case "smiles":
        return '<span class="smiles">';
      case "reference":
        return '<a href="#">';
      default:
        return `<${htmlTag}>`;
    }
  }

  private convertInlineContent(content: string): string {
    const inlineTagRegex = /<(code|formula|text|smiles)>(.*?)<\/\1>/s;
    let remainingText = content;
    let result = "";

    while (remainingText.length > 0) {
      const match = remainingText.match(inlineTagRegex);

      if (match && typeof match.index === "number") {
        const textBefore = remainingText.substring(0, match.index);
        result += this.escapeHtml(textBefore);

        const [fullMatch, tagName, innerContent] = match;

        switch (tagName) {
          case "code": {
            const langRegex = /<_(.*?)_>/;
            const langMatch = innerContent?.match(langRegex);
            if (langMatch?.[1]) {
              const language = this.sanitizeLanguageName(langMatch[1]);
              const codeContent = (innerContent ?? "").replace(langRegex, "").trim();
              const escapedCode = this.escapeHtml(codeContent);
              const langClass = language !== "unknown" ? ` class="language-${language}"` : "";
              result += `<code${langClass}>${escapedCode}</code>`;
            } else {
              result += `<code>${this.escapeHtml(innerContent ?? "")}</code>`;
            }
            break;
          }
          case "formula":
            result += `<span class="formula">${this.escapeHtml(innerContent ?? "")}</span>`;
            break;
          case "smiles":
            result += `<span class="smiles">${this.escapeHtml(innerContent ?? "")}</span>`;
            break;
          case "text":
            result += this.escapeHtml(innerContent ?? "");
            break;
        }

        remainingText = remainingText.substring(match.index + fullMatch.length);
      } else {
        result += this.escapeHtml(remainingText);
        break;
      }
    }

    return result;
  }

  private convertBlockCode(content: string): string {
    const langRegex = /<_(.*?)_>/;
    const langMatch = content.match(langRegex);
    let language = "unknown";
    let codeContent = content;

    if (langMatch?.[1]) {
      language = this.sanitizeLanguageName(langMatch[1]);
      codeContent = content.replace(langRegex, "").trim();
    }

    const escapedCode = this.escapeHtml(codeContent);
    const langClass = language !== "unknown" ? ` class="language-${language}"` : "";
    return `<pre><code${langClass}>${escapedCode}</code></pre>`;
  }

  private convertTable(content: string): string {
    const rows = content
      .trim()
      .split(/<nl>/)
      .filter((row) => row.length > 0);

    interface CellInfo {
      content: string;
      tag: string;
      colspan: number;
      rowspan: number;
    }

    const cellGrid: CellInfo[][] = [];

    rows.forEach((rowStr, rowIndex) => {
      const parts = rowStr.split(this.TABLE_TAG_REGEX);
      const currentRow: CellInfo[] = [];
      let gridColIndex = 0;

      for (let i = 1; i < parts.length; i += 2) {
        const tag = parts[i];
        const cellContent = parts[i + 1] ?? "";

        switch (tag) {
          case "<lcel>": {
            const lastCell = currentRow[currentRow.length - 1];
            if (lastCell) {
              lastCell.colspan++;
            }
            break;
          }
          case "<ucel>": {
            const prevRowCell = cellGrid[rowIndex - 1]?.[gridColIndex];
            if (rowIndex > 0 && prevRowCell) {
              prevRowCell.rowspan++;
            }
            gridColIndex++;
            break;
          }
          case "<xcel>": {
            const lastXCell = currentRow[currentRow.length - 1];
            if (lastXCell) {
              lastXCell.colspan++;
            }
            break;
          }
          default:
            if (tag && this.TABLE_TAG_CONFIG[tag]) {
              currentRow.push({
                content: cellContent,
                tag,
                colspan: 1,
                rowspan: 1,
              });
              gridColIndex++;
            }
            break;
        }
      }

      cellGrid.push(currentRow);
    });

    const htmlRows = cellGrid
      .map((row) => {
        const cellsHtml = row
          .map((cell) => {
            const config = this.TABLE_TAG_CONFIG[cell.tag];
            if (!config) return "";

            const attrs: string[] = [];
            if (cell.colspan > 1) attrs.push(`colspan="${cell.colspan}"`);
            if (cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`);
            if (config.scope) attrs.push(`scope="${config.scope}"`);

            const processedContent = this.processTags(cell.content);
            const attrString = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
            return `<${config.htmlTag}${attrString}>${processedContent}</${config.htmlTag}>`;
          })
          .join("");

        return `<tr>${cellsHtml}</tr>`;
      })
      .join("");

    return `<table><tbody>${htmlRows}</tbody></table>`;
  }

  private convertPictureOrChart(tag: string, content: string): string {
    if (/<(fcel|ched|rhed)>/.test(content)) {
      const cleanedContent = content.replace(/<[a-z_]+>/g, (match) => {
        if (
          match.startsWith("<fcel") ||
          match.startsWith("<ched") ||
          match.startsWith("<rhed") ||
          match.startsWith("<nl")
        ) {
          return match;
        }
        return "";
      });
      return this.convertTable(cleanedContent);
    }

    let captionHtml = "";
    const captionRegex = /<caption>(.*?)<\/caption>/s;
    const captionMatch = content.match(captionRegex);

    if (captionMatch?.[1]) {
      const captionContent = this.processTags(captionMatch[1]);
      captionHtml = `<figcaption>${captionContent}</figcaption>`;
    }

    const contentWithoutCaption = content.replace(captionRegex, "");
    const classificationRegex = /<([a-z_]+)>/;
    const classMatch = contentWithoutCaption.match(classificationRegex);

    let altText = tag;
    if (classMatch) {
      altText = classMatch[1]?.replace(/_/g, " ") ?? tag;
    }

    const imgHtml = `<img alt="${this.escapeHtml(altText)}" src="">`;
    const figureTag = this.simpleTagMap[tag] ?? "figure";
    return `<${figureTag}>${imgHtml}${captionHtml}</${figureTag}>`;
  }

  private sanitizeLanguageName(lang: string): string {
    const lowerLang = lang.toLowerCase();
    const aliasMap: Record<string, string> = {
      "c#": "csharp",
      "c++": "cpp",
      objectivec: "objective-c",
      visualbasic: "vb",
      javascript: "js",
      typescript: "ts",
      python: "py",
      ruby: "rb",
      dockerfile: "docker",
    };
    return aliasMap[lowerLang] ?? lowerLang.replace(/[\s#+]/g, "-");
  }

  private cleanupMetadataTokens(docling: string): string {
    return docling.replace(/<loc_[0-9]+>/g, "");
  }
}

/**
 * Convert Docling markup to a full HTML document
 */
export function doclingToHtml(docling: string): string {
  const converter = new DoclingConverter();
  const body = converter.convert(docling);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.23/dist/katex.min.css" integrity="sha384-//SZkxyB7axjCAopkAL1E1rve+ZSPKapD89Lo/lLhcsXR+zOYl5z6zJZEFXil+q0" crossorigin="anonymous">

    <style>
        html {
            background-color: #f5f5f5;
            font-family: Arial, sans-serif;
            line-height: 1.6;
        }
        header, footer {
            text-align: center;
            margin-bottom: 1rem;
            font-size: 1em;
        }
        body {
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            background-color: white;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        h1, h2, h3, h4, h5, h6 {
            color: #333;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
        }
        h1 {
            font-size: 2em;
            border-bottom: 1px solid #eee;
            padding-bottom: 0.3em;
        }
        table {
            border-collapse: collapse;
            margin: 1em 0;
            width: 100%;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #f2f2f2;
            font-weight: bold;
        }
        figure {
            margin: 1.5em 0;
            text-align: center;
        }
        figcaption {
            color: #666;
            font-style: italic;
            margin-top: 0.5em;
        }
        img {
            max-width: 100%;
            height: auto;
        }
        pre {
            background-color: #f6f8fa;
            border-radius: 3px;
            padding: 1em;
            overflow: auto;
        }
        code {
            font-family: monospace;
            background-color: #f6f8fa;
            padding: 0.2em 0.4em;
            border-radius: 3px;
        }
        pre code {
            background-color: transparent;
            padding: 0;
        }
        .formula {
            text-align: center;
            padding: 0.5em;
            margin: 1em 0;
        }
        .formula:not(:has(.katex)) {
            color: transparent;
        }
        .page-break {
            page-break-after: always;
            border-top: 1px dashed #ccc;
            margin: 2em 0;
        }
        .key-value-region {
            background-color: #f9f9f9;
            padding: 1em;
            border-radius: 4px;
            margin: 1em 0;
        }
        .key-value-region dt {
            font-weight: bold;
        }
        .key-value-region dd {
            margin-left: 1em;
            margin-bottom: 0.5em;
        }
        .form-container {
            border: 1px solid #ddd;
            padding: 1em;
            border-radius: 4px;
            margin: 1em 0;
        }
        .form-item {
            margin-bottom: 0.5em;
        }
    </style>
    </head>
<body>
${body}
<script type="module">
import katex from 'https://cdn.jsdelivr.net/npm/katex@0.16.23/dist/katex.mjs';
import renderMathInElement from "https://cdn.jsdelivr.net/npm/katex@0.16.23/dist/contrib/auto-render.mjs";

const mathElements = document.querySelectorAll('.formula');
for (let element of mathElements) {
    katex.render(element.textContent, element, {
        throwOnError: false,
    });
}

renderMathInElement(document.body, {
    delimiters: [
        {left: "$$", right: "$$", display: true},
        {left: "\\\\[", right: "\\\\]", display: true},
        {left: "$", right: "$", display: false},
        {left: "\\\\(", right: "\\\\)", display: false}
    ],
    throwOnError : false,
});
  </script>
</body>
</html>`;
}
