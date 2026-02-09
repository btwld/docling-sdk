/**
 * PDF to images renderer using unpdf (cross-runtime pdf.js wrapper)
 *
 * Renders PDF pages to data URL images for OCR processing.
 * Uses dynamic import so unpdf is only loaded when actually needed.
 */

import type { RenderedPage } from "../types/web";

/**
 * Render PDF pages to images using unpdf
 *
 * @param data - PDF file data as Uint8Array or ArrayBuffer
 * @param options - Rendering options
 * @returns Array of rendered page images as data URLs
 */
export async function renderPdfToImages(
  data: Uint8Array | ArrayBuffer,
  options?: { scale?: number }
): Promise<RenderedPage[]> {
  let getDocumentProxy: (data: Uint8Array) => Promise<{ numPages: number; getPage: (pageNum: number) => Promise<unknown> }>;

  try {
    const unpdf = await import("unpdf");
    getDocumentProxy = unpdf.getDocumentProxy as typeof getDocumentProxy;
  } catch {
    throw new Error(
      "unpdf is required for PDF processing. Install it: npm install unpdf"
    );
  }

  const scale = options?.scale ?? 2;
  const pdfData = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const pdf = await getDocumentProxy(pdfData);
  const pages: RenderedPage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    // biome-ignore lint/suspicious/noExplicitAny: pdf.js page type is complex
    const page = (await pdf.getPage(i)) as any;
    const viewport = page.getViewport({ scale });

    // Use OffscreenCanvas if available (Web Workers), otherwise regular canvas
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(viewport.width, viewport.height);
    } else if (typeof document !== "undefined") {
      canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
    } else {
      throw new Error("No canvas support available. PDF rendering requires a browser environment.");
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas 2d context");

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    let dataUrl: string;
    if (canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      dataUrl = await blobToDataUrl(blob);
    } else {
      dataUrl = canvas.toDataURL("image/png");
    }

    pages.push({
      pageNumber: i,
      dataUrl,
      width: viewport.width,
      height: viewport.height,
    });
  }

  return pages;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}
