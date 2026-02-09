/**
 * Extract element bounding boxes from DocTags output for visualization overlay
 *
 * Ported from web-ocr/packages/docling-client/src/overlay-extractor.ts
 */

import type { ElementOverlay } from "../../types/web";

const COORDINATE_SCALE = 500;

/**
 * Extract element bounding boxes from DocTags output
 *
 * Pattern: <tagname><loc_X1><loc_Y1><loc_X2><loc_Y2>
 * Coordinates are normalized from 0-500 scale to 0-1
 */
export function extractOverlays(doctags: string): ElementOverlay[] {
  const regex = /<(\w+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)>/g;
  const overlays: ElementOverlay[] = [];

  for (let match = regex.exec(doctags); match !== null; match = regex.exec(doctags)) {
    const [, tagType, l, t, r, b] = match;
    if (tagType && l && t && r && b) {
      overlays.push({
        tagType,
        bbox: {
          left: Number.parseInt(l) / COORDINATE_SCALE,
          top: Number.parseInt(t) / COORDINATE_SCALE,
          right: Number.parseInt(r) / COORDINATE_SCALE,
          bottom: Number.parseInt(b) / COORDINATE_SCALE,
        },
      });
    }
  }

  return overlays;
}
