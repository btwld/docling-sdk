import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomCache, clearModelCache, getModelCacheSize } from "../../src/web/cache";
import { renderPdfToImages } from "../../src/web/pdf-renderer";
const unpdf = vi.hoisted(() => ({ getDocumentProxy: vi.fn() }));
vi.mock("unpdf", () => unpdf);

class Reader {
  static fail = false;
  result: string | null = null;
  onload?: () => void;
  onerror?: () => void;
  async readAsDataURL(blob: Blob) {
    if (Reader.fail) {
      this.onerror?.();
      return;
    }
    this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
    this.onload?.();
  }
}
const entries = new Map<string, Response>();
const key = (request: string | Request) => (typeof request === "string" ? request : request.url);
const cache = {
  match: vi.fn(async (request: string | Request) => entries.get(key(request))?.clone()),
  put: vi.fn(async (request: string | Request, response: Response) => {
    entries.set(key(request), response);
  }),
  keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
};
const storage = {
  open: vi.fn(async () => cache),
  delete: vi.fn(async () => {
    entries.clear();
    return true;
  }),
};

beforeEach(() => {
  entries.clear();
  vi.clearAllMocks();
  Reader.fail = false;
  vi.stubGlobal("caches", storage);
  vi.stubGlobal("FileReader", Reader);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("download cache with real streams and responses", () => {
  it("normalizes model paths, persists full bytes and serves cloned cached responses", async () => {
    const bytes = new Uint8Array([1, 2, 255, 4]);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(bytes, {
          headers: { "Content-Length": "4", "Content-Type": "application/octet-stream" },
        })
      );
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();
    const models = createCustomCache(progress);
    const downloaded = await models.match("/models/org/model/config.json");
    expect(fetch).toHaveBeenCalledWith("https://huggingface.co/org/model/resolve/main/config.json");
    expect(new Uint8Array(await downloaded!.arrayBuffer())).toEqual(bytes);
    const cached = await models.match(
      new Request("https://huggingface.co/org/model/resolve/main/config.json")
    );
    expect(new Uint8Array(await cached!.arrayBuffer())).toEqual(bytes);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls).toContainEqual([1, "Cached: config.json"]);
    expect(progress.mock.calls).toContainEqual([1, "Downloaded: config.json"]);
    expect(await getModelCacheSize()).toBe(4);
    await models.put();
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(await clearModelCache()).toBe(true);
    expect(await getModelCacheSize()).toBe(0);
  });

  it.each([undefined, "invalid", "-3", "1"])(
    "bounds progress with Content-Length %s",
    async (contentLength) => {
      const headers = contentLength ? { "Content-Length": contentLength } : undefined;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("longer data", { headers })));
      const progress = vi.fn();
      const result = await createCustomCache(progress).match("https://example.test/model.bin");
      expect(await result!.text()).toBe("longer data");
      for (const [value] of progress.mock.calls) expect(value).toBeGreaterThanOrEqual(0);
      for (const [value] of progress.mock.calls) expect(value).toBeLessThanOrEqual(1);
      expect(progress.mock.calls.at(-1)).toEqual([1, "Downloaded: model.bin"]);
    }
  );

  it("keeps download progress local to each cache and releases failed readers", async () => {
    const error = new Error("download interrupted");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
      pull(controller) {
        controller.error(error);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(stream, { headers: { "Content-Length": "100" } }))
        .mockResolvedValueOnce(new Response("abc", { headers: { "Content-Length": "3" } }))
    );
    await expect(createCustomCache().match("https://example.test/failed.bin")).rejects.toBe(error);
    expect(stream.locked).toBe(false);
    expect(cache.put).not.toHaveBeenCalled();
    const progress = vi.fn();
    await createCustomCache(progress).match("https://example.test/second.bin");
    expect(progress.mock.calls[0]).toEqual([1, "Downloading: second.bin"]);
  });

  it("cancels a download when an observer throws and preserves the original failure", async () => {
    const canceled = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel: canceled,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    const error = new Error("observer failed");
    await expect(
      createCustomCache(() => {
        throw error;
      }).match("https://example.test/model.bin")
    ).rejects.toBe(error);
    expect(canceled).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("rejects failed HTTP responses and unreadable bodies without caching", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("bad", { status: 503, statusText: "Unavailable" }))
        .mockResolvedValueOnce(new Response(null))
    );
    await expect(createCustomCache().match("https://example.test/a")).rejects.toThrow(
      "503 Unavailable"
    );
    await expect(createCustomCache().match("https://example.test/b")).rejects.toThrow(
      "not readable"
    );
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("allows cache size enumeration when an entry disappears between keys and match", async () => {
    cache.keys.mockResolvedValueOnce([new Request("https://example.test/evicted")]);
    expect(await getModelCacheSize()).toBe(0);
  });
});

describe("PDF rendering lifecycle at the unpdf/canvas boundaries", () => {
  function document(numPages = 2) {
    const cleanup = vi.fn();
    const destroy = vi.fn();
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const getViewport = vi.fn(({ scale }) => ({ width: scale * 10, height: scale * 20 }));
    const page = { cleanup, render, getViewport };
    const pdf = { numPages, destroy, getPage: vi.fn(async () => page) };
    unpdf.getDocumentProxy.mockResolvedValue(pdf);
    return { ...pdf, page };
  }
  function htmlCanvas(context: unknown = {}) {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toDataURL: () => "data:image/png;base64,YQ==",
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    return canvas;
  }
  it("renders HTML canvas pages when OffscreenCanvas is absent and disposes resources", async () => {
    const pdf = document();
    const canvas = htmlCanvas();
    const data = new Uint8Array([1, 2]);
    const result = await renderPdfToImages(data.buffer);
    expect(unpdf.getDocumentProxy).toHaveBeenCalledWith(data);
    expect(result).toEqual(
      [1, 2].map((pageNumber) => ({
        pageNumber,
        dataUrl: "data:image/png;base64,YQ==",
        width: 20,
        height: 40,
      }))
    );
    expect(canvas.width).toBe(20);
    expect(canvas.height).toBe(40);
    expect(pdf.page.cleanup).toHaveBeenCalledTimes(2);
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });
  it("renders offscreen canvases using Blob data URLs and custom scale", async () => {
    const pdf = document(1);
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number
        ) {}
        getContext() {
          return {};
        }
        async convertToBlob() {
          return new Blob(["png"], { type: "image/png" });
        }
      }
    );
    const result = await renderPdfToImages(new Uint8Array([1]), { scale: 3 });
    expect(result[0]).toEqual({
      pageNumber: 1,
      width: 30,
      height: 60,
      dataUrl: "data:image/png;base64,cG5n",
    });
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });
  it.each(["canvas", "context", "render", "read", "page"])(
    "disposes the PDF on %s failure",
    async (failure) => {
      const pdf = document(1);
      htmlCanvas(failure === "context" ? null : {});
      if (failure === "canvas") vi.stubGlobal("document", undefined);
      if (failure === "render")
        pdf.page.render.mockImplementationOnce(() => ({
          promise: Promise.reject(new Error("render failed")),
        }));
      if (failure === "page") pdf.getPage.mockRejectedValueOnce(new Error("page failed"));
      if (failure === "read") {
        Reader.fail = true;
        vi.stubGlobal(
          "OffscreenCanvas",
          class {
            getContext() {
              return {};
            }
            async convertToBlob() {
              return new Blob(["x"]);
            }
          }
        );
      }
      await expect(renderPdfToImages(new Uint8Array([1]))).rejects.toThrow();
      expect(pdf.destroy).toHaveBeenCalledOnce();
      expect(pdf.page.cleanup).toHaveBeenCalledTimes(failure === "page" ? 0 : 1);
    }
  );
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid scale %s before loading a PDF",
    async (scale) => {
      await expect(renderPdfToImages(new Uint8Array([1]), { scale })).rejects.toThrow(
        "positive and finite"
      );
      expect(unpdf.getDocumentProxy).not.toHaveBeenCalled();
    }
  );
  it("returns an empty page inventory and supports minimal PDF proxy implementations", async () => {
    unpdf.getDocumentProxy.mockResolvedValueOnce({ numPages: 0, getPage: vi.fn() });
    expect(await renderPdfToImages(new Uint8Array([1]))).toEqual([]);
    htmlCanvas();
    unpdf.getDocumentProxy.mockResolvedValueOnce({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 1, height: 2 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    });
    expect(await renderPdfToImages(new Uint8Array([1]))).toHaveLength(1);
  });
  it("reports a missing optional PDF library with installation guidance", async () => {
    vi.resetModules();
    vi.doMock("unpdf", () => {
      throw new Error("module unavailable");
    });
    const { renderPdfToImages: withoutLibrary } = await import("../../src/web/pdf-renderer");
    await expect(withoutLibrary(new Uint8Array([1]))).rejects.toThrow("unpdf is required");
  });
});
