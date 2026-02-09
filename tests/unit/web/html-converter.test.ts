import { describe, it, expect } from "vitest";
import { DoclingConverter, doclingToHtml } from "../../../src/web/converters/html-converter";

describe("DoclingConverter (HTML)", () => {
  const converter = new DoclingConverter();

  it("converts title tag to h1", () => {
    const result = converter.convert("<title>Hello World</title>");
    expect(result).toContain("<h1>Hello World</h1>");
  });

  it("converts section header levels", () => {
    expect(converter.convert("<section_header_level_0>Level 1</section_header_level_0>"))
      .toContain("<h1>");
    expect(converter.convert("<section_header_level_1>Level 2</section_header_level_1>"))
      .toContain("<h2>");
    expect(converter.convert("<section_header_level_2>Level 3</section_header_level_2>"))
      .toContain("<h3>");
  });

  it("converts text/paragraph tag to p", () => {
    const result = converter.convert("<text>Some text</text>");
    expect(result).toContain("<p>Some text</p>");
  });

  it("converts paragraph tag to p", () => {
    const result = converter.convert("<paragraph>Some paragraph</paragraph>");
    expect(result).toContain("<p>Some paragraph</p>");
  });

  it("converts code block with language", () => {
    const result = converter.convert("<code><_python_>print('hello')</code>");
    expect(result).toContain('<code class="language-py">');
    expect(result).toContain("print(");
  });

  it("converts code block without language", () => {
    const result = converter.convert("<code>var x = 1;</code>");
    expect(result).toContain("<pre><code>");
    expect(result).toContain("var x = 1;");
  });

  it("converts ordered list", () => {
    const result = converter.convert(
      "<ordered_list><list_item>First</list_item><list_item>Second</list_item></ordered_list>"
    );
    expect(result).toContain("<ol>");
    expect(result).toContain("<li>");
    expect(result).toContain("First");
    expect(result).toContain("Second");
  });

  it("converts unordered list", () => {
    const result = converter.convert(
      "<unordered_list><list_item>Item A</list_item><list_item>Item B</list_item></unordered_list>"
    );
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>");
  });

  it("converts table with OTSL format", () => {
    const result = converter.convert(
      "<otsl><ched>Name<ched>Age<nl><fcel>Alice<fcel>30</otsl>"
    );
    expect(result).toContain("<table>");
    expect(result).toContain("<th>Name</th>");
    expect(result).toContain("<td>Alice</td>");
  });

  it("strips location tokens", () => {
    const result = converter.convert("<text><loc_100><loc_200>Hello</text>");
    expect(result).toContain("Hello");
    expect(result).not.toContain("loc_");
  });

  it("escapes HTML entities in content", () => {
    const result = converter.convert("<text>a < b & c > d</text>");
    expect(result).toContain("&lt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&gt;");
  });

  it("converts picture tag to figure", () => {
    const result = converter.convert("<picture><caption>My image</caption></picture>");
    expect(result).toContain("<figure>");
    expect(result).toContain("<figcaption>");
    expect(result).toContain("My image");
  });

  it("converts self-closing tags", () => {
    const result = converter.convert("<text>Before</text><page_break><text>After</text>");
    expect(result).toContain("page-break");
  });
});

describe("doclingToHtml", () => {
  it("returns a full HTML document", () => {
    const result = doclingToHtml("<text>Hello</text>");
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("<html>");
    expect(result).toContain("<body>");
    expect(result).toContain("Hello");
    expect(result).toContain("</html>");
  });

  it("includes KaTeX stylesheet", () => {
    const result = doclingToHtml("<text>test</text>");
    expect(result).toContain("katex");
  });
});
