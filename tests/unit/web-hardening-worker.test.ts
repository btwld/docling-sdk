import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transformers = vi.hoisted(() => ({
  processor: vi.fn(),
  model: vi.fn(),
  loadImage: vi.fn(),
  env: { backends: { onnx: { wasm: { marker: true }, marker: true } } } as Record<string, unknown>,
}));
vi.mock("@huggingface/transformers", () => ({
  AutoProcessor: { from_pretrained: transformers.processor },
  AutoModelForVision2Seq: { from_pretrained: transformers.model },
  load_image: transformers.loadImage,
  env: transformers.env,
  TextStreamer: class {
    constructor(
      public tokenizer: unknown,
      public options: unknown
    ) {}
  },
}));

let scope: {
  postMessage: ReturnType<typeof vi.fn>;
  onmessage: ((event: { data: unknown }) => Promise<void>) | null;
};
let processor: ReturnType<typeof vi.fn> & {
  tokenizer?: unknown;
  apply_chat_template?: ReturnType<typeof vi.fn>;
};
let generate: ReturnType<typeof vi.fn>;
const sample = "<doctag><title>Fixture title</title><text>Fixture text.</text></doctag>";
async function load() {
  await import("../../src/web/worker");
}
async function send(data: unknown) {
  await scope.onmessage!({ data });
}
function messages(type: string) {
  return scope.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === type);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  transformers.env.backends = { onnx: { wasm: { marker: true }, marker: true } };
  scope = { postMessage: vi.fn(), onmessage: null };
  vi.stubGlobal("self", scope);
  vi.stubGlobal("navigator", { gpu: {} });
  processor = Object.assign(vi.fn().mockResolvedValue({ pixel_values: "fixture-pixels" }), {
    tokenizer: { name: "fixture tokenizer" },
    apply_chat_template: vi.fn().mockReturnValue("fixture prompt"),
  });
  generate = vi.fn(async (options) => {
    options.streamer.options.callback_function(sample);
    options.streamer.options.callback_function("<|end_of_text|>");
  });
  transformers.processor.mockResolvedValue(processor);
  transformers.model.mockResolvedValue({ generate });
  transformers.loadImage.mockResolvedValue({ fixture: "decoded image" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("worker message contract at transformer I/O boundary", () => {
  it("initializes, reports model download progress and preserves backend configuration", async () => {
    transformers.model.mockImplementationOnce(async (_id, options) => {
      const callback = options.progress_callback;
      callback({ status: "done", file: "other" });
      callback({ status: "progress" });
      callback({ status: "progress", file: "weights1.onnx_data", loaded: 1, total: 2 });
      callback({ status: "progress", file: "weights2.onnx_data", loaded: 1, total: 2 });
      callback({ status: "progress", file: "weights3.onnx_data", loaded: 1, total: 2 });
      return { generate };
    });
    await load();
    await send({
      type: "INIT",
      config: { device: "webgpu", modelId: "fixture/model", wasmPaths: { wasm: "/runtime.wasm" } },
    });
    expect(transformers.processor).toHaveBeenCalledWith("fixture/model");
    expect(transformers.model).toHaveBeenCalledWith(
      "fixture/model",
      expect.objectContaining({ device: "webgpu" })
    );
    expect(messages("READY")).toEqual([{ type: "READY" }]);
    expect(messages("PROGRESS")).toContainEqual({
      type: "PROGRESS",
      progress: 0.5,
      status: "Downloading model: 50%",
    });
    expect(transformers.env).toMatchObject({
      useBrowserCache: false,
      useFSCache: false,
      useCustomCache: true,
      allowRemoteModels: true,
      allowLocalModels: false,
      backends: {
        onnx: { marker: true, wasm: { marker: true, wasmPaths: { wasm: "/runtime.wasm" } } },
      },
    });
    const custom = transformers.env.customCache as { match: unknown; put: unknown };
    expect(typeof custom.match).toBe("function");
    await send({ type: "INIT", config: { device: "webgpu", modelId: "fixture/model" } });
    expect(transformers.model).toHaveBeenCalledTimes(1);
    expect(messages("READY")).toHaveLength(2);
  });

  it.each([undefined, "auto", "webgpu", "wasm"])(
    "selects wasm when GPU is unavailable for device %s",
    async (device) => {
      vi.stubGlobal("navigator", undefined);
      await load();
      await send({ type: "INIT", config: { device } });
      expect(transformers.model).toHaveBeenCalledWith(
        "onnx-community/granite-docling-258M-ONNX",
        expect.objectContaining({ device: "wasm" })
      );
      expect(messages("ERROR")).toEqual([]);
    }
  );

  it("forwards real cache download progress through worker messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("fixture", { headers: { "Content-Length": "7" } }))
    );
    vi.stubGlobal("caches", {
      open: async () => ({ match: async () => undefined, put: async () => {} }),
    });
    transformers.processor.mockImplementationOnce(async () => {
      const cache = transformers.env.customCache as { match: (url: string) => Promise<Response> };
      expect(await (await cache.match("https://example.test/model.json")).text()).toBe("fixture");
      return processor;
    });
    await load();
    await send({ type: "INIT", config: { device: "wasm" } });
    expect(messages("PROGRESS")).toContainEqual({
      type: "PROGRESS",
      progress: 1,
      status: "Downloaded: model.json",
    });
    expect(messages("READY")).toHaveLength(1);
  });

  it("streams fixture generation and runs actual SDK converters and extractors", async () => {
    await load();
    await send({ type: "INIT", config: { device: "wasm" } });
    await send({ type: "PROCESS_FILE", src: "data:image/png;base64,YQ==", maxNewTokens: 1 });
    expect(transformers.loadImage).toHaveBeenCalledWith("data:image/png;base64,YQ==");
    expect(processor).toHaveBeenCalledWith("fixture prompt", [{ fixture: "decoded image" }], {
      do_image_splitting: true,
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ pixel_values: "fixture-pixels", max_new_tokens: 1 })
    );
    expect(messages("REPORT").map((message) => message.status)).toEqual([
      "Loading image...",
      "Constructing prompt...",
      "Processing...",
    ]);
    expect(messages("STREAM")).toEqual([
      { type: "STREAM", chunk: sample, progress: 1 },
      { type: "STREAM", chunk: "<|end_of_text|>", progress: 1 },
    ]);
    expect(messages("DONE")[0]).toMatchObject({
      type: "DONE",
      text: sample,
      markdown: "# Fixture title\n\nFixture text.",
      plainText: expect.stringContaining("Fixture text."),
      html: expect.stringContaining("Fixture title"),
      json: { schema_name: "DoclingDocument" },
      tables: [],
      overlays: [],
    });
    // Fixture model output tests the SDK protocol; it supplies no model quality evidence.
    await send({ type: "PROCESS_FILE", src: "data:image/png;base64,Yg==" });
    expect(generate).toHaveBeenLastCalledWith(expect.objectContaining({ max_new_tokens: 4096 }));
  });

  it("queues processing behind initialization rather than racing model startup", async () => {
    let resolveProcessor!: (value: unknown) => void;
    transformers.processor.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProcessor = resolve;
        })
    );
    await load();
    const init = send({ type: "INIT", config: { device: "wasm" } });
    await Promise.resolve();
    await Promise.resolve();
    const process = send({ type: "PROCESS_FILE", src: "data:image/png;base64,YQ==" });
    expect(transformers.loadImage).not.toHaveBeenCalled();
    resolveProcessor(processor);
    await Promise.all([init, process]);
    expect(messages("ERROR")).toEqual([]);
    expect(messages("DONE")).toHaveLength(1);
  });

  it("reports processing before initialization and unknown message types as protocol errors", async () => {
    await load();
    await send({ type: "PROCESS_FILE", src: "data:image/png;base64,YQ==" });
    await send({ type: "UNKNOWN" });
    expect(messages("ERROR")).toEqual([
      { type: "ERROR", error: "Worker not initialized. Send INIT message first." },
      { type: "ERROR", error: "Unknown message type: UNKNOWN" },
    ]);
    expect(transformers.loadImage).not.toHaveBeenCalled();
  });

  it("reports failed model startup, supports retry and forwards non-Error failures", async () => {
    transformers.model.mockRejectedValueOnce(new Error("download failed"));
    await load();
    await send({ type: "INIT", config: { device: "wasm" } });
    expect(messages("ERROR")).toEqual([{ type: "ERROR", error: "download failed" }]);
    await send({ type: "INIT", config: { device: "wasm" } });
    expect(messages("READY")).toHaveLength(1);
    transformers.loadImage.mockRejectedValueOnce("decode failed");
    await send({ type: "PROCESS_FILE", src: "broken" });
    expect(messages("ERROR").at(-1)).toEqual({ type: "ERROR", error: "decode failed" });
    expect(messages("DONE")).toHaveLength(0);
  });

  it("reports tokenizer and generation failures without emitting a successful result", async () => {
    processor.tokenizer = undefined;
    await load();
    await send({ type: "INIT", config: { device: "wasm" } });
    await send({ type: "PROCESS_FILE", src: "image" });
    expect(messages("ERROR").at(-1)).toEqual({ type: "ERROR", error: "Tokenizer not available" });
    processor.tokenizer = {};
    generate.mockRejectedValueOnce(new Error("inference failed"));
    await send({ type: "PROCESS_FILE", src: "image" });
    expect(messages("ERROR").at(-1)).toEqual({ type: "ERROR", error: "inference failed" });
    expect(messages("DONE")).toHaveLength(0);
  });
});
