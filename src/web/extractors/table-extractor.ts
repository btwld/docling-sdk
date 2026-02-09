/**
 * Table Extractor
 *
 * Extracts tables from DocTags markup and provides CSV conversion.
 * Ported from web-ocr/packages/docling-client/src/table-extractor.ts
 */

import type { ExtractedTable } from "../../types/web";

function cleanContent(content: string): string {
  return content.replace(/<loc_\d+>/g, "").trim();
}

function parseTable(content: string): ExtractedTable {
  const rows = content
    .trim()
    .split(/<nl>/)
    .filter((row) => row.length > 0);

  const cellTagRegex = /<(ched|rhed|srow|fcel|ecel|ucel|lcel|xcel)>/g;
  const tableRows: string[][] = [];
  const headerIndices: Set<number> = new Set();
  let maxCols = 0;

  rows.forEach((rowStr, rowIndex) => {
    const cells: string[] = [];
    const parts = rowStr.split(cellTagRegex);
    let hasHeaderInRow = false;

    for (let i = 1; i < parts.length; i += 2) {
      const tag = parts[i];
      const cellContent = cleanContent(parts[i + 1] ?? "");

      if (tag === "ched" || tag === "rhed" || tag === "srow") {
        hasHeaderInRow = true;
      }

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

    if (hasHeaderInRow) {
      headerIndices.add(rowIndex);
    }

    maxCols = Math.max(maxCols, cells.length);
    tableRows.push(cells);
  });

  for (const row of tableRows) {
    while (row.length < maxCols) {
      row.push("");
    }
  }

  let headerRows: string[][] = [];
  let dataRows: string[][] = [];

  if (headerIndices.size > 0) {
    let headerEndIndex = 0;
    for (let i = 0; i < tableRows.length; i++) {
      if (headerIndices.has(i)) {
        headerEndIndex = i + 1;
      } else {
        break;
      }
    }
    headerRows = tableRows.slice(0, headerEndIndex);
    dataRows = tableRows.slice(headerEndIndex);
  } else if (tableRows.length > 0) {
    headerRows = [tableRows[0] ?? []];
    dataRows = tableRows.slice(1);
  }

  const headers =
    headerRows.length > 0
      ? (headerRows[0] ?? []).map((_, colIndex) =>
          headerRows.map((row) => row[colIndex] || "").join(" / ")
        )
      : [];

  return {
    headers: headers.map((h) => h.trim()),
    rows: dataRows,
  };
}

/**
 * Extract all tables from DocTags markup
 */
export function extractTables(doctags: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];

  const otslRegex = /<otsl>([\s\S]*?)<\/otsl>/g;

  for (let match = otslRegex.exec(doctags); match !== null; match = otslRegex.exec(doctags)) {
    const tableContent = match[1] ?? "";
    const table = parseTable(tableContent);

    if (table.headers.length > 0 || table.rows.length > 0) {
      tables.push(table);
    }
  }

  const pictureTableRegex = /<(?:picture|chart)>([\s\S]*?)<\/(?:picture|chart)>/g;
  for (let match = pictureTableRegex.exec(doctags); match !== null; match = pictureTableRegex.exec(doctags)) {
    const content = match[1] ?? "";
    if (/<(fcel|ched|rhed)>/.test(content)) {
      const cleanedContent = content.replace(/<(?!nl|fcel|ched|rhed|srow|ecel|ucel|lcel|xcel)[a-z_]+>/g, "");
      const table = parseTable(cleanedContent);
      if (table.headers.length > 0 || table.rows.length > 0) {
        tables.push(table);
      }
    }
  }

  return tables;
}

function escapeCSVValue(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert an extracted table to CSV format
 */
export function tableToCSV(table: ExtractedTable): string {
  const lines: string[] = [];

  if (table.headers.length > 0) {
    lines.push(table.headers.map(escapeCSVValue).join(","));
  }

  for (const row of table.rows) {
    lines.push(row.map(escapeCSVValue).join(","));
  }

  return lines.join("\n");
}

/**
 * Convert all tables to a single CSV with table separators
 */
export function tablesToCSV(tables: ExtractedTable[]): string {
  return tables
    .map((table, index) => {
      const csv = tableToCSV(table);
      return tables.length > 1 ? `# Table ${index + 1}\n${csv}` : csv;
    })
    .join("\n\n");
}
