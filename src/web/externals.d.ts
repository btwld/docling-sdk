/**
 * Ambient type declarations for optional web dependencies
 * These are dynamically imported only when the web client is used.
 */

declare module "unpdf" {
  export function getDocumentProxy(data: Uint8Array): Promise<{
    numPages: number;
    getPage(pageNum: number): Promise<{
      getViewport(params: { scale: number }): { width: number; height: number };
      render(params: {
        canvasContext: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
        viewport: { width: number; height: number };
      }): { promise: Promise<void> };
    }>;
  }>;
}

declare module "@huggingface/transformers" {
  export const env: {
    useBrowserCache: boolean;
    useFSCache: boolean;
    useCustomCache: boolean;
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    customCache: unknown;
    backends: unknown;
  };

  export const AutoProcessor: {
    // biome-ignore lint/suspicious/noExplicitAny: transformers.js types
    from_pretrained(modelId: string): Promise<any>;
  };

  export class AutoModelForVision2Seq {
    // biome-ignore lint/suspicious/noExplicitAny: transformers.js types
    static from_pretrained(modelId: string, options?: any): Promise<AutoModelForVision2Seq>;
    // biome-ignore lint/suspicious/noExplicitAny: transformers.js types
    generate(options: any): Promise<any>;
  }

  export class TextStreamer {
    // biome-ignore lint/suspicious/noExplicitAny: transformers.js types
    constructor(tokenizer: any, options?: any);
  }

  // biome-ignore lint/suspicious/noExplicitAny: transformers.js types
  export function load_image(src: string): Promise<any>;
}
