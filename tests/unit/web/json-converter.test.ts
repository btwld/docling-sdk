import { describe, it, expect } from "vitest";
import { doclingToJson } from "../../../src/web/converters/json-converter";

describe("doclingToJson", () => {
  it("returns a valid DoclingDocument structure", () => {
    const result = doclingToJson("<text>Hello</text>");
    expect(result.schema_name).toBe("DoclingDocument");
    expect(result.version).toBe("1.0.0");
    expect(result.body.label).toBe("body");
    expect(result.pages).toBeDefined();
  });

  it("uses custom document name", () => {
    const result = doclingToJson("<text>Hello</text>", "my-doc");
    expect(result.name).toBe("my-doc");
  });

  it("extracts text items", () => {
    const result = doclingToJson("<text>Hello world</text>");
    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]!.text).toBe("Hello world");
    expect(result.texts[0]!.label).toBe("text");
  });

  it("extracts title items", () => {
    const result = doclingToJson("<title>My Title</title>");
    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]!.label).toBe("title");
    expect(result.texts[0]!.text).toBe("My Title");
  });

  it("extracts section headers with level", () => {
    const result = doclingToJson("<section_header_level_1>Chapter</section_header_level_1>");
    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]!.label).toBe("section_header");
    expect(result.texts[0]!.level).toBe(2);
  });

  it("extracts tables", () => {
    const result = doclingToJson("<otsl><ched>Name<ched>Age<nl><fcel>Alice<fcel>30</otsl>");
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.label).toBe("table");
    expect(result.tables[0]!.data.num_cols).toBeGreaterThan(0);
  });

  it("extracts pictures", () => {
    const result = doclingToJson("<picture><caption>My image</caption></picture>");
    expect(result.pictures).toHaveLength(1);
    expect(result.pictures[0]!.label).toBe("picture");
    expect(result.pictures[0]!.caption).toBe("My image");
  });

  it("extracts charts as pictures", () => {
    const result = doclingToJson("<chart><caption>My chart</caption></chart>");
    expect(result.pictures).toHaveLength(1);
    expect(result.pictures[0]!.label).toBe("chart");
  });

  it("extracts code items with language", () => {
    const result = doclingToJson("<code><_python_>print('hi')</code>");
    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]!.label).toBe("code");
    expect(result.texts[0]!.language).toBe("python");
  });

  it("extracts list items from ordered list", () => {
    const result = doclingToJson(
      "<ordered_list><list_item>First</list_item><list_item>Second</list_item></ordered_list>"
    );
    expect(result.texts).toHaveLength(2);
    expect(result.texts[0]!.label).toBe("list_item");
    expect(result.texts[0]!.enumerated).toBe(true);
  });

  it("creates body children references", () => {
    const result = doclingToJson(
      "<title>Title</title><text>Content</text>"
    );
    expect(result.body.children.length).toBeGreaterThan(0);
    expect(result.body.children[0]!.$ref).toMatch(/^#\/texts\/\d+$/);
  });

  it("parses location tokens to bounding boxes", () => {
    const result = doclingToJson("<text><loc_100><loc_200><loc_300><loc_400>Hello</text>");
    expect(result.texts).toHaveLength(1);
    const prov = result.texts[0]!.prov;
    expect(prov).toBeDefined();
    expect(prov!.length).toBe(1);
    expect(prov![0]!.bbox.l).toBe(0.1);
    expect(prov![0]!.bbox.t).toBe(0.2);
  });

  it("handles nested doctag container", () => {
    const result = doclingToJson("<doctag><text>Inside</text></doctag>");
    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]!.text).toBe("Inside");
  });
});
