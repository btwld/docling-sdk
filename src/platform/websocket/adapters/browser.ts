/**
 * Browser WebSocket adapter
 * Uses native WebSocket API available in browsers, Deno, and Bun
 */

import { randomUUID } from "../../binary";
import { stringToUint8Array, uint8ArrayToString, type BinaryData } from "../../binary";
import type {
  WebSocketAdapter,
  WebSocketAdapterOptions,
  WebSocketCloseEvent,
  WebSocketHooks,
  WebSocketMessage,
  WebSocketPeer,
  WebSocketReadyState,
} from "../types";
import { WebSocketReadyState as ReadyState } from "../types";

/**
 * Create a WebSocket message wrapper
 */
function createMessage(data: string | ArrayBuffer | Blob): WebSocketMessage {
  const isText = typeof data === "string";

  let binaryData: BinaryData;
  let textData: string;

  if (typeof data === "string") {
    textData = data;
    binaryData = stringToUint8Array(data);
  } else if (data instanceof ArrayBuffer) {
    binaryData = new Uint8Array(data);
    textData = uint8ArrayToString(binaryData);
  } else {
    // Blob - can't handle synchronously, use placeholder
    textData = "";
    binaryData = new Uint8Array(0);
  }

  return {
    data: isText ? textData : binaryData,
    type: isText ? "text" : "binary",
    json<T = unknown>(): T {
      return JSON.parse(textData) as T;
    },
    text(): string {
      return textData;
    },
    binary(): BinaryData {
      return binaryData;
    },
  };
}

/**
 * Browser WebSocket peer implementation
 */
class BrowserWebSocketPeer implements WebSocketPeer {
  readonly id: string;
  readonly url: string;
  private ws: WebSocket;
  private eventHandlers: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  constructor(ws: WebSocket, url: string) {
    this.id = randomUUID();
    this.url = url;
    this.ws = ws;
  }

  get readyState(): WebSocketReadyState {
    return this.ws.readyState as WebSocketReadyState;
  }

  get protocol(): string {
    return this.ws.protocol;
  }

  send(data: string | BinaryData): void {
    if (this.ws.readyState !== ReadyState.OPEN) {
      throw new Error("WebSocket is not open");
    }

    if (typeof data === "string") {
      this.ws.send(data);
    } else {
      this.ws.send(data);
    }
  }

  sendText(data: string): void {
    this.send(data);
  }

  sendBinary(data: BinaryData): void {
    this.send(data);
  }

  close(code = 1000, reason = ""): void {
    this.ws.close(code, reason);
  }

  terminate(): void {
    this.ws.close(1000, "Terminated");
  }

  subscribe(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)?.add(handler);
  }

  unsubscribe(event: string, handler: (...args: unknown[]) => void): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  getRaw(): WebSocket {
    return this.ws;
  }

  /** Emit event to handlers */
  emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}

/**
 * Browser WebSocket adapter
 */
export class BrowserWebSocketAdapter implements WebSocketAdapter {
  private options: WebSocketAdapterOptions;
  private hooks: WebSocketHooks;
  private peer: BrowserWebSocketPeer | null = null;
  private ws: WebSocket | null = null;

  constructor(options: WebSocketAdapterOptions) {
    this.options = options;
    this.hooks = options.hooks ?? {};
  }

  async connect(): Promise<WebSocketPeer> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url, this.options.protocols);
        this.ws.binaryType = "arraybuffer";

        this.peer = new BrowserWebSocketPeer(this.ws, this.options.url);

        // Setup timeout
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
        if (this.options.timeout) {
          timeoutId = globalThis.setTimeout(() => {
            if (this.ws?.readyState === ReadyState.CONNECTING) {
              this.ws.close();
              reject(new Error("WebSocket connection timeout"));
            }
          }, this.options.timeout);
        }

        // Setup event handlers
        const peer = this.peer;

        this.ws.onopen = () => {
          if (timeoutId) globalThis.clearTimeout(timeoutId);
          if (peer) {
            this.hooks.open?.(peer);
            resolve(peer);
          }
        };

        this.ws.onmessage = (event) => {
          if (peer) {
            const message = createMessage(event.data);
            this.hooks.message?.(peer, message);
          }
        };

        this.ws.onclose = (event) => {
          if (timeoutId) globalThis.clearTimeout(timeoutId);
          if (peer) {
            const closeEvent: WebSocketCloseEvent = {
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean,
            };
            this.hooks.close?.(peer, closeEvent);
          }
        };

        this.ws.onerror = (_event) => {
          if (timeoutId) globalThis.clearTimeout(timeoutId);
          if (peer) {
            const errorEvent = {
              message: "WebSocket error",
              error: new Error("WebSocket error"),
            };
            this.hooks.error?.(peer, errorEvent);
          }
          if (this.ws?.readyState === ReadyState.CONNECTING) {
            reject(new Error("WebSocket connection failed"));
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  isConnected(): boolean {
    return this.ws?.readyState === ReadyState.OPEN;
  }

  getPeer(): WebSocketPeer | null {
    return this.peer;
  }

  close(code = 1000, reason = ""): void {
    this.ws?.close(code, reason);
    this.ws = null;
    this.peer = null;
  }

  setHooks(hooks: WebSocketHooks): void {
    this.hooks = hooks;
  }

  getHooks(): WebSocketHooks {
    return this.hooks;
  }

  getType(): "browser" | "node" | "universal" {
    return "browser";
  }
}

/**
 * Create a browser WebSocket adapter
 */
export function createBrowserWebSocketAdapter(options: WebSocketAdapterOptions): BrowserWebSocketAdapter {
  return new BrowserWebSocketAdapter(options);
}
