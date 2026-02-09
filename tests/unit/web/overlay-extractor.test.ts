import { describe, it, expect } from "vitest";
import { extractOverlays } from "../../../src/web/extractors/overlay-extractor";

describe("extractOverlays", () => {
  it("extracts element bounding boxes from DocTags", () => {
    const doctags = "<text><loc_100><loc_200><loc_300><loc_400>Hello</text>";
    const overlays = extractOverlays(doctags);
    expect(overlays).toHaveLength(1);
    expect(overlays[0]!.tagType).toBe("text");
    expect(overlays[0]!.bbox.left).toBeCloseTo(0.2);
    expect(overlays[0]!.bbox.top).toBeCloseTo(0.4);
    expect(overlays[0]!.bbox.right).toBeCloseTo(0.6);
    expect(overlays[0]!.bbox.bottom).toBeCloseTo(0.8);
  });

  it("extracts multiple overlays", () => {
    const doctags =
      "<title><loc_0><loc_0><loc_250><loc_50>Title</title>" +
      "<text><loc_0><loc_100><loc_500><loc_200>Content</text>";
    const overlays = extractOverlays(doctags);
    expect(overlays).toHaveLength(2);
    expect(overlays[0]!.tagType).toBe("title");
    expect(overlays[1]!.tagType).toBe("text");
  });

  it("normalizes coordinates from 0-500 to 0-1", () => {
    const doctags = "<text><loc_0><loc_0><loc_500><loc_500>Full page</text>";
    const overlays = extractOverlays(doctags);
    expect(overlays[0]!.bbox.left).toBe(0);
    expect(overlays[0]!.bbox.top).toBe(0);
    expect(overlays[0]!.bbox.right).toBe(1);
    expect(overlays[0]!.bbox.bottom).toBe(1);
  });

  it("returns empty array for content without location tokens", () => {
    const doctags = "<text>Hello</text>";
    const overlays = extractOverlays(doctags);
    expect(overlays).toHaveLength(0);
  });

  it("handles various tag types", () => {
    const doctags =
      "<table><loc_10><loc_20><loc_30><loc_40>Data</table>" +
      "<picture><loc_50><loc_60><loc_70><loc_80>Image</picture>";
    const overlays = extractOverlays(doctags);
    expect(overlays).toHaveLength(2);
    expect(overlays[0]!.tagType).toBe("table");
    expect(overlays[1]!.tagType).toBe("picture");
  });
});
