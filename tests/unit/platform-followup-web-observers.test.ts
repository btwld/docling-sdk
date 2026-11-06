import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DoclingWebClient } from "../../src/clients/web-client";
import type { WorkerMessageFromWorker } from "../../src/types/web";
import { doclingToJson } from "../../src/web/converters/json-converter";

// A browser reports listener exceptions without turning them into worker errors.
// Node's EventTarget instead schedules an uncaught exception, so model that
// browser dispatch boundary explicitly and retain the reported errors for assertions.
class BrowserWorker {
  static instances: BrowserWorker[] = [];
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  reportedErrors: unknown[] = [];
  sent: unknown[] = [];
  terminated = false;

  constructor() {
    BrowserWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message: unknown) {
    this.sent.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  message(data: WorkerMessageFromWorker) {
    for (const listener of this.listeners.get("message") ?? []) {
      try {
        listener(new MessageEvent("message", { data }));
      } catch (error) {
        this.reportedErrors.push(error);
      }
    }
  }
}

const done: WorkerMessageFromWorker = {
  type: "DONE",
  text: "<text>healthy inference</text>",
  html: "<p>healthy inference</p>",
  markdown: "healthy inference",
  plainText: "healthy inference",
  json: doclingToJson("<text>healthy inference</text>"),
  tables: [],
  overlays: [],
};
let client: DoclingWebClient;
function worker() {
  const instance = BrowserWorker.instances.at(-1);
  if (!instance) throw new Error("Expected initialized worker");
  return instance;
}
async function ready() {
  const startup = client.initialize();
  worker().message({ type: "READY" });
  await startup;
}

beforeEach(() => {
  BrowserWorker.instances = [];
  vi.stubGlobal("Worker", BrowserWorker);
  client = new DoclingWebClient({ type: "web", workerUrl: "/worker.js" });
});
afterEach(() => {
  client.destroy();
  vi.unstubAllGlobals();
});

describe("Web client observer error boundary", () => {
  it.each(["loading", "ready"] as const)(
    "reports a throwing %s observer without failing model startup",
    async (event) => {
      const failure = new Error("render observer failed");
      const errors = vi.fn();
      client.on("error", errors).on(event, () => {
        throw failure;
      });
      const startup = client.initialize().then(
        () => "ready",
        (error: unknown) => error
      );
      if (event === "loading")
        worker().message({ type: "PROGRESS", progress: 0.5, status: "Loading model" });
      worker().message({ type: "READY" });
      expect(await startup).toBe("ready");
      expect(worker().reportedErrors).toEqual([failure]);
      expect(errors).not.toHaveBeenCalled();
      expect(worker().terminated).toBe(false);
      expect(client.ready).toBe(true);
    }
  );

  it.each(["status", "stream", "complete"] as const)(
    "completes healthy OCR and reuses the model after a throwing %s observer",
    async (event) => {
      await ready();
      const failure = new Error("render observer failed");
      const observer = () => {
        throw failure;
      };
      const errors = vi.fn();
      client.on(event, observer).on("error", errors);
      const result = client.processImage("data:image/png;base64,YQ==").catch((error) => error);
      await Promise.resolve();
      expect(worker().sent.at(-1)).toMatchObject({ type: "PROCESS_FILE" });
      worker().message({ type: "REPORT", status: "Processing" });
      worker().message({ type: "STREAM", chunk: "healthy", progress: 0.5 });
      worker().message(done);
      expect(await result).toMatchObject({ plainText: "healthy inference" });
      expect(worker().reportedErrors).toEqual([failure]);
      expect(errors).not.toHaveBeenCalled();
      expect(worker().terminated).toBe(false);
      expect(client.ready).toBe(true);
      expect(client.processing).toBe(false);

      client.off(event, observer);
      const next = client.processImage("data:image/png;base64,Yg==");
      await Promise.resolve();
      worker().message(done);
      expect((await next).plainText).toBe("healthy inference");
      expect(BrowserWorker.instances).toHaveLength(1);
    }
  );

  it("preserves the actual inference rejection when its error observer throws", async () => {
    await ready();
    const failure = new Error("error observer failed");
    const errors = vi.fn(() => {
      throw failure;
    });
    client.on("error", errors);
    const result = client.processImage("data:image/png;base64,YQ==");
    const assertion = expect(result).rejects.toThrow("inference failed");
    await Promise.resolve();
    worker().message({ type: "ERROR", error: "inference failed" });
    await assertion;
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith({ message: "inference failed" });
    expect(worker().reportedErrors).toEqual([failure]);
    expect(worker().terminated).toBe(false);
    expect(client.ready).toBe(true);
    expect(client.processing).toBe(false);
  });
});
