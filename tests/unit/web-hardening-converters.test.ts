import { describe, expect, it } from "vitest";
import {
  DoclingConverter,
  doclingToHtml,
  doclingToJson,
  doclingToMarkdown,
  doclingToPlainText,
  extractTables,
  tableToCSV,
  tablesToCSV,
  extractOverlays,
} from "../../src/web";

const html = new DoclingConverter();
describe("public DocTags formats and exported entry points", () => {
  it.each([0, 1, 2, 3, 4, 5])("preserves section header level %s across formats", (level) => {
    const source = `<section_header_level_${level}>Chapter</section_header_level_${level}>`;
    expect(doclingToMarkdown(source)).toBe(`${"#".repeat(Math.min(level + 2, 6))} Chapter`);
    expect(doclingToPlainText(source)).toBe("Chapter\n-------");
    expect(doclingToJson(source).texts[0]).toMatchObject({
      label: "section_header",
      level: level + 1,
    });
    expect(html.convert(source)).toBe(`<h${level + 1}>Chapter</h${level + 1}>`);
  });

  it.each([
    ["paragraph", "Example", "Example", "Example"],
    ["caption", "Figure caption", "*Figure caption*", "[Figure caption]"],
    ["footnote", "Source note", "[^note]: Source note", "[Note: Source note]"],
    ["page_header", "Repeating header", "", ""],
    ["page_footer", "Repeating footer", "", ""],
    ["page_break", "", "---", "─".repeat(40)],
    ["checkbox_selected", "", "- [x]", "[X]"],
    ["checkbox_unselected", "", "- [ ]", "[ ]"],
    ["list_item", "- Task", "- Task", "* Task"],
    ["reference", "Reference", "Reference", "Reference"],
    ["smiles", "CO", "CO", "CO"],
    ["formula", "E=mc^2", "$E=mc^2$", "E=mc^2"],
    ["unknown", "Visible content", "Visible content", "Visible content"],
    ["unknown", "", "", ""],
  ])(
    "converts %s into its public text and Markdown representation",
    (tag, content, markdown, text) => {
      const source = `<${tag}>${content}</${tag}>`;
      expect(doclingToMarkdown(source)).toBe(markdown);
      expect(doclingToPlainText(source)).toBe(text);
    }
  );

  it("preserves inline spaces and removes only location metadata", () => {
    const source =
      "<inline>Before <loc_10><code>x</code> and <formula>y</formula>, <smiles>CO</smiles> <text>text</text> after.</inline>";
    expect(doclingToMarkdown(source)).toBe("Before `x` and $y$, `CO` text after.");
    expect(doclingToPlainText(source)).toBe("Before x and y, CO text after.");
    expect(html.convert(source)).toBe(
      'Before <code>x</code> and <span class="formula">y</span>, <span class="smiles">CO</span> text after.'
    );
    expect(html.convert("<inline>no tags & plain</inline>")).toBe("no tags &amp; plain");
  });

  it("escapes unknown markup and prevents language metadata from injecting HTML attributes", () => {
    const payload = '<code><_x" onclick="alert(1)_>a < b & c</code>';
    expect(html.convert(payload)).toBe(
      '<pre><code class="language-x--onclick--alert-1-">a &lt; b &amp; c</code></pre>'
    );
    expect(html.convert("<inline><code><_javascript_>x & y</code></inline>")).toBe(
      '<code class="language-js">x &amp; y</code>'
    );
    expect(html.convert("<inline><code><_unknown_>x</code></inline>")).toBe("<code>x</code>");
    expect(html.convert("<unknown><text>safe</text></unknown>")).toBe(
      "&lt;unknown&gt;&lt;text&gt;safe&lt;/text&gt;&lt;/unknown&gt;"
    );
    expect(html.convert('unclosed <script>alert("x")')).toBe(
      "unclosed &lt;script&gt;alert(&quot;x&quot;)"
    );
    expect(doclingToHtml("<text>safe</text>")).toContain("<p>safe</p>");
  });

  it("keeps document containers, code, formula blocks and surrounding text", () => {
    const source =
      "<document>before<paragraph>Body</paragraph><code>plain code</code><formula>x\ny</formula>after</document>";
    expect(doclingToMarkdown(source)).toBe(
      "before\n\nBody\n\n```\nplain code\n```\n\n$$\nx\ny\n$$\n\nafter"
    );
    expect(doclingToPlainText(source)).toBe("before\n\nBody\n\n    plain code\n\nx\ny\n\nafter");
    expect(doclingToJson(source).texts.map((item) => [item.label, item.text])).toEqual([
      ["text", "Body"],
      ["code", "plain code"],
      ["formula", "x\ny"],
    ]);
    expect(doclingToMarkdown("before <text>middle</text> after")).toBe("before\n\nmiddle\n\nafter");
    expect(doclingToPlainText("before <text>middle</text> after")).toBe(
      "before\n\nmiddle\n\nafter"
    );
    expect(doclingToMarkdown("")).toBe("");
    expect(doclingToPlainText("")).toBe("");
    expect(doclingToJson("unfinished <text>").texts).toEqual([]);
    expect(
      html.convert(
        "<document_index>Index</document_index><form>Form</form><key_value_region>Value</key_value_region><reference>Ref</reference><smiles>CO</smiles>"
      )
    ).toBe(
      '<div class="toc">Index</div><form>Form</form><dl>Value</dl><a href="#">Ref</a><span class="smiles">CO</span>'
    );
  });

  it("extracts labeled JSON text, ordered/unordered lists and resets references per document", () => {
    const source =
      "<caption>Caption</caption><footnote>Note</footnote><page_header>Header</page_header><page_footer>Footer</page_footer><unordered_list><list_item>- Item</list_item></unordered_list><paragraph>Paragraph</paragraph><unknown>Fallback</unknown><empty></empty>";
    const result = doclingToJson(source, "fixture");
    expect(result.texts.map((item) => item.label)).toEqual([
      "caption",
      "footnote",
      "page_header",
      "page_footer",
      "list_item",
      "text",
      "text",
    ]);
    expect(result.texts[4]).toMatchObject({ text: "Item", enumerated: false });
    expect(result.body.children).toEqual(result.texts.map((item) => ({ $ref: item.self_ref })));
    expect(doclingToJson("<text>Next document</text>").texts[0]?.self_ref).toBe("#/texts/0");
  });

  it("renders captioned/classified pictures and chart tables through the public formats", () => {
    expect(html.convert("<picture><bar_chart><caption>Totals</caption></picture>")).toBe(
      '<figure><img alt="bar chart" src=""><figcaption>Totals</figcaption></figure>'
    );
    expect(html.convert("<chart></chart>")).toBe('<figure><img alt="chart" src=""></figure>');
    expect(html.convert("<chart><caption></caption></chart>")).toBe(
      '<figure><img alt="chart" src=""></figure>'
    );
    expect(html.convert("<chart><fcel>Value<nl><fcel>42</chart>")).toBe(
      "<table><tbody><tr><td>Value</td></tr><tr><td>42</td></tr></tbody></table>"
    );
    expect(doclingToMarkdown("<chart></chart>")).toBe("![chart]()");
    expect(doclingToPlainText("<chart></chart>")).toBe("[[chart]]");
    expect(doclingToJson("<picture></picture>").pictures[0]?.caption).toBeUndefined();
  });
});

describe("table and overlay export boundaries", () => {
  it("handles empty and uneven OTSL grids without inventing cells", () => {
    for (const source of ["<otsl></otsl>", "<otsl>not cell markup</otsl>"]) {
      expect(doclingToMarkdown(source)).toBe("");
      expect(doclingToPlainText(source)).toBe("");
    }
    const source = "<otsl><ched>A|B<ched>C<nl><fcel>value<nl><fcel>x<ecel></otsl>";
    expect(doclingToMarkdown(source)).toBe("| A\\|B | C |\n| --- | --- |\n| value |  |\n| x |  |");
    expect(doclingToPlainText(source)).toBe("A|B\tC\nvalue\t\nx");
  });

  it("represents horizontal/vertical spans and row-header scope", () => {
    const source =
      "<otsl><ched>Name<lcel><ched>Count<nl><ucel><xcel><rhed>row<nl><srow>Total<ecel>3</otsl>";
    const result = doclingToJson(source).tables[0]!.data;
    expect(result).toMatchObject({ num_rows: 3, num_cols: 3 });
    expect(result.table_cells[0]).toMatchObject({
      text: "Name",
      col_span: 2,
      row_span: 2,
      col_header: true,
    });
    expect(result.table_cells.find((cell) => cell.text === "row")).toMatchObject({
      row_header: true,
    });
    const resultHtml = html.convert(source);
    expect(resultHtml).toContain('colspan="2"');
    expect(resultHtml).toContain('rowspan="2"');
    expect(resultHtml).toContain('scope="row"');
    const detached = "<otsl><lcel><ucel><xcel><fcel>A</otsl>";
    expect(doclingToJson(detached).tables[0]?.data.table_cells[0]?.text).toBe("A");
    expect(html.convert(detached)).toContain("<td>A</td>");
  });

  it("extracts stacked table headers, uneven rows and escaping-sensitive CSV", () => {
    const source = "<otsl><ched>Group<ched>Count<nl><ched>Name<ched>Value<nl><fcel>A</otsl>";
    expect(extractTables(source)).toEqual([
      { headers: ["Group / Name", "Count / Value"], rows: [["A", ""]] },
    ]);
    expect(extractTables("<otsl><fcel>A<nl><rhed>B</otsl>")).toEqual([
      { headers: [], rows: [["A"], ["B"]] },
    ]);
    expect(tableToCSV({ headers: [], rows: [["line\rbreak", 'say "hi"', "a,b"]] })).toBe(
      '"line\rbreak","say ""hi""","a,b"'
    );
    expect(tablesToCSV([])).toBe("");
    expect(
      tablesToCSV([
        { headers: ["one"], rows: [] },
        { headers: ["two"], rows: [] },
      ])
    ).toBe("# Table 1\none\n\n# Table 2\ntwo");
    expect(extractOverlays("<text><loc_0><loc_0><loc_500><loc_500>whole page</text>")).toEqual([
      { tagType: "text", bbox: { left: 0, top: 0, right: 1, bottom: 1 } },
    ]);
  });
});
