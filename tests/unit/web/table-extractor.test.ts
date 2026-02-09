import { describe, it, expect } from "vitest";
import {
  extractTables,
  tableToCSV,
  tablesToCSV,
} from "../../../src/web/extractors/table-extractor";

describe("extractTables", () => {
  it("extracts tables from OTSL tags", () => {
    const doctags = "<otsl><ched>Name<ched>Age<nl><fcel>Alice<fcel>30</otsl>";
    const tables = extractTables(doctags);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.headers).toEqual(["Name", "Age"]);
    expect(tables[0]!.rows).toEqual([["Alice", "30"]]);
  });

  it("extracts multiple tables", () => {
    const doctags =
      "<otsl><ched>A<ched>B<nl><fcel>1<fcel>2</otsl>" +
      "<text>Some text</text>" +
      "<otsl><ched>X<ched>Y<nl><fcel>3<fcel>4</otsl>";
    const tables = extractTables(doctags);
    expect(tables).toHaveLength(2);
  });

  it("handles merged cells (lcel)", () => {
    const doctags = "<otsl><ched>Name<ched>Age<nl><fcel>Alice<lcel></otsl>";
    const tables = extractTables(doctags);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows[0]).toEqual(["Alice", ""]);
  });

  it("handles empty tables gracefully", () => {
    const doctags = "<text>No tables here</text>";
    const tables = extractTables(doctags);
    expect(tables).toHaveLength(0);
  });

  it("extracts tables inside picture tags", () => {
    const doctags = "<picture><fcel>Data<ched>Header<nl><fcel>Val</picture>";
    const tables = extractTables(doctags);
    expect(tables.length).toBeGreaterThan(0);
  });

  it("strips location tokens from cell content", () => {
    const doctags = "<otsl><ched><loc_10><loc_20>Name<nl><fcel><loc_30>Alice</otsl>";
    const tables = extractTables(doctags);
    expect(tables[0]!.headers[0]).toBe("Name");
    expect(tables[0]!.rows[0]![0]).toBe("Alice");
  });
});

describe("tableToCSV", () => {
  it("converts table to CSV format", () => {
    const csv = tableToCSV({ headers: ["Name", "Age"], rows: [["Alice", "30"]] });
    expect(csv).toBe("Name,Age\nAlice,30");
  });

  it("escapes values with commas", () => {
    const csv = tableToCSV({ headers: ["Name"], rows: [["Alice, Bob"]] });
    expect(csv).toContain('"Alice, Bob"');
  });

  it("escapes values with quotes", () => {
    const csv = tableToCSV({ headers: ["Name"], rows: [['He said "hi"']] });
    expect(csv).toContain('"He said ""hi"""');
  });
});

describe("tablesToCSV", () => {
  it("combines multiple tables with separators", () => {
    const tables = [
      { headers: ["A"], rows: [["1"]] },
      { headers: ["B"], rows: [["2"]] },
    ];
    const csv = tablesToCSV(tables);
    expect(csv).toContain("# Table 1");
    expect(csv).toContain("# Table 2");
  });

  it("does not add separator for single table", () => {
    const tables = [{ headers: ["A"], rows: [["1"]] }];
    const csv = tablesToCSV(tables);
    expect(csv).not.toContain("# Table");
  });
});
