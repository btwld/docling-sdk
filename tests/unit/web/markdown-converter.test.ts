import { describe, it, expect } from "vitest";
import { doclingToMarkdown } from "../../../src/web/converters/markdown-converter";

describe("doclingToMarkdown", () => {
  it("converts title to h1", () => {
    const result = doclingToMarkdown("<title>Hello</title>");
    expect(result).toBe("# Hello");
  });

  it("converts section header levels", () => {
    expect(doclingToMarkdown("<section_header_level_0>H2</section_header_level_0>")).toContain("## H2");
    expect(doclingToMarkdown("<section_header_level_1>H3</section_header_level_1>")).toContain("### H3");
    expect(doclingToMarkdown("<section_header_level_2>H4</section_header_level_2>")).toContain("#### H4");
    expect(doclingToMarkdown("<section_header_level_3>H5</section_header_level_3>")).toContain("##### H5");
  });

  it("converts text to paragraphs", () => {
    const result = doclingToMarkdown("<text>Hello world</text>");
    expect(result).toBe("Hello world");
  });

  it("converts code blocks with language", () => {
    const result = doclingToMarkdown("<code><_python_>print('hi')</code>");
    expect(result).toContain("```python");
    expect(result).toContain("print('hi')");
    expect(result).toContain("```");
  });

  it("converts ordered lists", () => {
    const result = doclingToMarkdown(
      "<ordered_list><list_item>First</list_item><list_item>Second</list_item></ordered_list>"
    );
    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
  });

  it("converts unordered lists", () => {
    const result = doclingToMarkdown(
      "<unordered_list><list_item>A</list_item><list_item>B</list_item></unordered_list>"
    );
    expect(result).toContain("- A");
    expect(result).toContain("- B");
  });

  it("converts tables to markdown format", () => {
    const result = doclingToMarkdown("<otsl><ched>Name<ched>Age<nl><fcel>Alice<fcel>30</otsl>");
    expect(result).toContain("| Name | Age |");
    expect(result).toContain("| --- | --- |");
    expect(result).toContain("| Alice | 30 |");
  });

  it("strips location tokens", () => {
    const result = doclingToMarkdown("<text><loc_100><loc_200>Hello</text>");
    expect(result).toBe("Hello");
  });

  it("converts pictures with caption", () => {
    const result = doclingToMarkdown("<picture><caption>My figure</caption></picture>");
    expect(result).toContain("![My figure]()");
  });

  it("converts formulas", () => {
    const result = doclingToMarkdown("<formula>E = mc^2</formula>");
    expect(result).toContain("$E = mc^2$");
  });

  it("handles page breaks", () => {
    const result = doclingToMarkdown(
      "<doctag><text>Before</text><text>After</text></doctag>"
    );
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });
});
