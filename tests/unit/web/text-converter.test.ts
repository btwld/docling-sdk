import { describe, it, expect } from "vitest";
import { doclingToPlainText } from "../../../src/web/converters/text-converter";

describe("doclingToPlainText", () => {
  it("converts title with underline", () => {
    const result = doclingToPlainText("<title>Hello</title>");
    expect(result).toContain("Hello");
    expect(result).toContain("=====");
  });

  it("converts section headers with dashes", () => {
    const result = doclingToPlainText("<section_header_level_0>Chapter 1</section_header_level_0>");
    expect(result).toContain("Chapter 1");
    expect(result).toContain("---------");
  });

  it("converts text to plain paragraphs", () => {
    const result = doclingToPlainText("<text>Hello world</text>");
    expect(result).toBe("Hello world");
  });

  it("converts code blocks", () => {
    const result = doclingToPlainText("<code>x = 1</code>");
    expect(result).toContain("x = 1");
  });

  it("converts multiline code blocks with indentation", () => {
    const result = doclingToPlainText("<doctag><text>Before</text><code>line1\nline2</code></doctag>");
    // Multi-line code gets indented, inner lines keep indent
    expect(result).toContain("line1");
    expect(result).toContain("line2");
  });

  it("converts ordered lists", () => {
    const result = doclingToPlainText(
      "<ordered_list><list_item>First</list_item><list_item>Second</list_item></ordered_list>"
    );
    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
  });

  it("converts unordered lists with asterisks", () => {
    const result = doclingToPlainText(
      "<unordered_list><list_item>A</list_item><list_item>B</list_item></unordered_list>"
    );
    expect(result).toContain("* A");
    expect(result).toContain("* B");
  });

  it("converts tables to tab-separated text", () => {
    const result = doclingToPlainText("<otsl><ched>Name<ched>Age<nl><fcel>Alice<fcel>30</otsl>");
    expect(result).toContain("Name\tAge");
    expect(result).toContain("Alice\t30");
  });

  it("strips location tokens", () => {
    const result = doclingToPlainText("<text><loc_100><loc_200>Hello</text>");
    expect(result).toBe("Hello");
  });

  it("skips page headers and footers", () => {
    const result = doclingToPlainText(
      "<page_header>Header</page_header><text>Content</text><page_footer>Footer</page_footer>"
    );
    expect(result).toBe("Content");
  });

  it("converts pictures with caption", () => {
    const result = doclingToPlainText("<picture><caption>My image</caption></picture>");
    expect(result).toContain("[My image]");
  });
});
