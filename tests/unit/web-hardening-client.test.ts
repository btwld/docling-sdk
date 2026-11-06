import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DoclingWebClient } from "../../src/clients/web-client";
import { doclingToJson } from "../../src/web/converters/json-converter";

const pdf = vi.hoisted(() => ({ getDocumentProxy: vi.fn() }));
vi.mock("unpdf", () => pdf);

const done = {
  type: "DONE",
  text: "<text>hello</text>",
  html: "<p>hello</p>",
  markdown: "hello",
  plainText: "hello",
  json: doclingToJson("<text>hello</text>"),
  tables: [],
  overlays: [],
};
class MockWorker extends EventTarget {
  static instances: MockWorker[] = [];
  static auto = false;
  static failPost = false;
  sent: unknown[] = [];
  terminated = false;
  constructor(
    public url: string,
    public options: unknown
  ) {
    super();
    MockWorker.instances.push(this);
  }
  terminate() {
    this.terminated = true;
  }
  postMessage(message: { type: string }) {
    if (MockWorker.failPost) throw new Error("postMessage failed");
    this.sent.push(message);
    if (MockWorker.auto)
      queueMicrotask(() => this.message(message.type === "INIT" ? { type: "READY" } : done));
  }
  message(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  crash(message?: string) {
    this.dispatchEvent(Object.assign(new Event("error"), { message }));
  }
}
class MockReader {
  static fail = false;
  result: string | null = null;
  onload?: () => void;
  onerror?: () => void;
  async readAsDataURL(blob: Blob) {
    if (MockReader.fail) {
      this.onerror?.();
      return;
    }
    this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
    this.onload?.();
  }
}
class Canvas {
  width = 0;
  height = 0;
  static missingContext = false;
  getContext() {
    return Canvas.missingContext ? null : { drawImage: vi.fn() };
  }
  toDataURL() {
    return "data:image/png;base64,Y2FudmFz";
  }
}
class Offscreen extends Canvas {
  async convertToBlob() {
    return new Blob(["offscreen"], { type: "image/png" });
  }
}
class Image {
  naturalWidth = 10;
  naturalHeight = 20;
  width = 1;
  height = 2;
}
class Bitmap {
  width = 4;
  height = 5;
}
const clients: DoclingWebClient[] = [];
function client(config = {}) {
  const result = new DoclingWebClient({ type: "web", workerUrl: "/worker.js", ...config });
  clients.push(result);
  return result;
}
function worker() {
  return MockWorker.instances.at(-1)!;
}
async function ready(result: DoclingWebClient) {
  const init = result.initialize();
  worker().message({ type: "READY" });
  await init;
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  MockWorker.instances = [];
  MockWorker.auto = false;
  MockWorker.failPost = false;
  MockReader.fail = false;
  Canvas.missingContext = false;
  vi.stubGlobal("Worker", MockWorker);
  vi.stubGlobal("FileReader", MockReader);
  vi.stubGlobal("HTMLCanvasElement", Canvas);
  vi.stubGlobal("OffscreenCanvas", Offscreen);
  vi.stubGlobal("HTMLImageElement", Image);
  vi.stubGlobal("ImageBitmap", Bitmap);
  vi.stubGlobal("document", { createElement: () => new Canvas() });
});
afterEach(() => {
  for (const item of clients.splice(0)) item.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("worker client request lifetime", () => {
  it("shares initialization and reports progress exactly once", async () => {
    const sdk = client();
    const loading = vi.fn();
    const onReady = vi.fn();
    sdk.on("loading", loading).on("ready", onReady);
    const first = sdk.initialize();
    const second = sdk.initialize();
    expect(first).toBe(second);
    expect(MockWorker.instances).toHaveLength(1);
    worker().message({ type: "PROGRESS", progress: 0.5, status: "loading model" });
    worker().message({ type: "READY" });
    await Promise.all([first, second, sdk.initialize()]);
    expect(sdk.ready).toBe(true);
    expect(loading).toHaveBeenCalledWith({ progress: 0.5, status: "loading model" });
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(worker().sent).toHaveLength(1);
    sdk.off("ready", onReady);
  });

  it.each(["ERROR", "error", "messageerror", "destroy"])(
    "settles initialization on %s and can initialize again",
    async (failure) => {
      const sdk = client();
      const pending = sdk.initialize();
      const assertion = expect(pending).rejects.toThrow();
      const old = worker();
      if (failure === "ERROR") old.message({ type: "ERROR", error: "load failure" });
      else if (failure === "error") old.crash();
      else if (failure === "messageerror") old.dispatchEvent(new Event("messageerror"));
      else sdk.destroy();
      await assertion;
      expect(old.terminated).toBe(true);
      expect(sdk.ready).toBe(false);
      await ready(sdk);
      old.message({ type: "READY" });
      expect(sdk.ready).toBe(true);
      expect(MockWorker.instances).toHaveLength(2);
    }
  );

  it("revokes generated blob URLs on ready, failure, construction failure and destroy", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:model-worker");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const sdk = client({ workerUrl: undefined });
    await ready(sdk);
    expect(create).toHaveBeenCalledWith(expect.any(Blob));
    expect(worker().url).toBe("blob:model-worker");
    expect(revoke).toHaveBeenCalledTimes(1);
    sdk.destroy();
    const pending = sdk.initialize();
    const assertion = expect(pending).rejects.toThrow("Client destroyed");
    sdk.destroy();
    await assertion;
    expect(revoke).toHaveBeenCalledTimes(2);
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked by CSP");
        }
      }
    );
    await expect(sdk.initialize()).rejects.toThrow("blocked by CSP");
    expect(revoke).toHaveBeenCalledTimes(3);
  });

  it("settles both postMessage initialization and processing errors", async () => {
    const sdk = client();
    MockWorker.failPost = true;
    await expect(sdk.initialize()).rejects.toThrow("postMessage failed");
    MockWorker.failPost = false;
    await ready(sdk);
    MockWorker.failPost = true;
    await expect(sdk.processImage("data:image/png;base64,YQ==")).rejects.toThrow(
      "postMessage failed"
    );
    expect(sdk.processing).toBe(false);
  });

  it.each(["ERROR", "error", "messageerror", "destroy"])(
    "settles image requests on %s without duplicate error listeners",
    async (failure) => {
      const sdk = client();
      await ready(sdk);
      const errors = vi.fn();
      sdk.on("error", errors);
      const promise = sdk.processImage("data:image/png;base64,YQ==");
      const assertion = expect(promise).rejects.toThrow();
      await flush();
      if (failure === "ERROR") worker().message({ type: "ERROR", error: "inference failed" });
      else if (failure === "error") worker().crash("worker crashed");
      else if (failure === "messageerror") worker().dispatchEvent(new Event("messageerror"));
      else sdk.destroy();
      await assertion;
      expect(sdk.processing).toBe(false);
      expect(errors).toHaveBeenCalledTimes(failure === "destroy" ? 0 : 1);
      if (failure === "ERROR") {
        const next = sdk.processImage("data:image/png;base64,Yg==");
        await flush();
        worker().message(done);
        expect((await next).plainText).toBe("hello");
      }
    }
  );

  it("does not post a late image fetch into a destroyed or replacement worker", async () => {
    const sdk = client();
    await ready(sdk);
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    const request = sdk.processImage("https://example.test/image.png");
    const assertion = expect(request).rejects.toThrow("Client destroyed");
    sdk.destroy();
    await assertion;
    await ready(sdk);
    const replacement = worker();
    resolveFetch(new Response("image"));
    await flush();
    expect(replacement.sent).toHaveLength(1);
    expect(sdk.processing).toBe(false);
  });

  it("reports stream/status and completes only the active image request", async () => {
    const sdk = client();
    await ready(sdk);
    const stream = vi.fn();
    const status = vi.fn();
    const complete = vi.fn();
    sdk.on("stream", stream).on("status", status).on("complete", complete);
    const result = sdk.processImage("data:image/png;base64,YQ==", { maxNewTokens: 20 });
    await expect(sdk.processImage("data:image/png;base64,Yg==")).rejects.toThrow(
      "Already processing"
    );
    await flush();
    expect(worker().sent.at(-1)).toEqual({
      type: "PROCESS_FILE",
      src: "data:image/png;base64,YQ==",
      maxNewTokens: 20,
    });
    worker().message({ type: "REPORT", status: "processing" });
    worker().message({ type: "STREAM", chunk: "hello", progress: 0.5 });
    worker().message(done);
    expect(await result).toMatchObject({ plainText: "hello", raw: "<text>hello</text>" });
    worker().message(done);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledWith({ chunk: "hello", progress: 0.5 });
    expect(status).toHaveBeenCalledWith({ status: "processing" });
  });
});

describe("image and conversion boundaries", () => {
  it("supports Blob, URL, canvas, offscreen, image and bitmap inputs", async () => {
    MockWorker.auto = true;
    const sdk = client();
    await sdk.initialize();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("remote", { headers: { "Content-Type": "image/png" } }))
    );
    for (const input of [
      new Blob(["image"], { type: "image/png" }),
      "https://example.test/image.png",
      new Canvas(),
      new Offscreen(),
      new Image(),
      new Bitmap(),
    ]) {
      expect((await sdk.processImage(input as never)).plainText).toBe("hello");
      expect(worker().sent.at(-1)).toMatchObject({
        type: "PROCESS_FILE",
        src: expect.stringMatching(/^data:image\/png;base64,/),
      });
    }
    // OffscreenCanvas does not inherit HTMLCanvasElement in browsers.
    vi.stubGlobal("HTMLCanvasElement", class {});
    await sdk.processImage(new Offscreen() as never);
    expect(worker().sent.at(-1)).toMatchObject({ src: "data:image/png;base64,b2Zmc2NyZWVu" });
  });

  it("rejects unavailable image resources, readers, invalid input and canvas contexts", async () => {
    MockWorker.auto = true;
    const sdk = client();
    await sdk.initialize();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    await expect(sdk.processImage("https://example.test/missing.png")).rejects.toThrow(
      "Image fetch failed: 404"
    );
    MockReader.fail = true;
    await expect(sdk.processImage(new Blob(["a"]))).rejects.toThrow("Failed to read blob");
    MockReader.fail = false;
    await expect(sdk.processImage({} as never)).rejects.toThrow("Unsupported image input");
    Canvas.missingContext = true;
    await expect(sdk.processImage(new Image() as never)).rejects.toThrow("canvas context");
    await expect(sdk.processImage(new Bitmap() as never)).rejects.toThrow("canvas context");
    expect(sdk.processing).toBe(false);
  });

  it("converts images through every public alias and returns the declared response shape", async () => {
    MockWorker.auto = true;
    const sdk = client();
    for (const method of [
      "convert",
      "extractText",
      "toHtml",
      "toMarkdown",
      "convertDocument",
      "process",
    ] as const) {
      const output = await sdk[method](new Uint8Array([1, 2]), "scan.PNG", {});
      expect(output).toMatchObject({
        status: "success",
        processing_time: 0,
        errors: [],
        document: {
          filename: "scan.PNG",
          md_content: "hello",
          html_content: "<p>hello</p>",
          text_content: "hello",
          doctags_content: "<text>hello</text>",
        },
      });
    }
    expect((await sdk.convert("YQ==", "scan.jpg")).status).toBe("success");
    expect((await sdk.convert("data:image/png;base64,YQ==", "scan.png")).status).toBe("success");
    const safe = await sdk.safeConvert("YQ==", "scan.png");
    expect(safe.success).toBe(true);
  });

  it.each(["office.docx", "slides.pptx", "page.html", "data.csv", "unknown"])(
    "rejects unsupported input %s before starting model downloads",
    async (filename) => {
      const sdk = client();
      await expect(sdk.convert(new Uint8Array([1]), filename)).rejects.toThrow(
        "Unsupported web input"
      );
      expect(MockWorker.instances).toHaveLength(0);
      expect((await sdk.safeConvert("data", filename)).success).toBe(false);
    }
  );

  it("rejects split-page HTML without claiming to implement it", async () => {
    const sdk = client();
    await expect(
      sdk.convert("YQ==", "image.png", { to_formats: ["html_split_page"] })
    ).rejects.toThrow("not supported");
    expect(MockWorker.instances).toHaveLength(0);
  });

  it("renders PDFs at the library boundary, combines pages and accepts PDF data URLs", async () => {
    MockWorker.auto = true;
    const cleanup = vi.fn();
    const destroy = vi.fn();
    pdf.getDocumentProxy.mockImplementation(async () => ({
      numPages: 2,
      destroy,
      getPage: async () => ({
        cleanup,
        getViewport: () => ({ width: 10, height: 20 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }));
    const sdk = client();
    const result = await sdk.convert("data:application/pdf;base64,AQI=", "scan.pdf");
    expect(pdf.getDocumentProxy).toHaveBeenCalledWith(new Uint8Array([1, 2]));
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
    expect(result.document.md_content).toBe("hello\n\n---\n\nhello");
    expect(result.document.json_content?.name).toBe("scan.pdf");
    expect((await sdk.convert(new Uint8Array([1]), "scan.pdf")).status).toBe("success");
  });
});

describe("generated module worker bootstrap", () => {
  it.each(["load", "failure"])(
    "buffers INIT until module %s and settles initialization",
    async (outcome) => {
      let blob!: Blob;
      vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
        blob = value as Blob;
        return "blob:bootstrap";
      });
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const sdk = client({ workerUrl: undefined });
      const pending = sdk.initialize();
      const assertion =
        outcome === "failure"
          ? expect(pending).rejects.toThrow("module failed")
          : expect(pending).resolves.toBeUndefined();
      const scope = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        postMessage: (message: unknown) => worker().message(message),
      };
      let loaded!: () => void;
      let failed!: (error: Error) => void;
      const loading = new Promise<void>((resolve, reject) => {
        loaded = resolve;
        failed = reject;
      });
      const importModule = vi.fn(() => loading);
      const importerBoundary = () => importModule;
      const bootstrap = new Function("self", "Function", await blob.text());
      bootstrap(scope, importerBoundary);
      const initEvent = new MessageEvent("message", { data: worker().sent[0] });
      scope.onmessage!(initEvent);
      const handler = vi.fn(() => worker().message({ type: "READY" }));
      expect(handler).not.toHaveBeenCalled();
      expect(importModule).toHaveBeenCalledWith("docling-sdk/web/worker");
      if (outcome === "failure") failed(new Error("module failed"));
      else {
        scope.onmessage = handler;
        loaded();
      }
      await assertion;
      if (outcome === "load") expect(handler).toHaveBeenCalledWith(initEvent);
      else expect(worker().terminated).toBe(true);
      expect(revoke).toHaveBeenCalledOnce();
    }
  );
});
