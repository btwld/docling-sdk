/**
 * Browser WebSocket adapter
 * Uses native WebSocket API available in browsers, Deno, and Bun
 */

import { type BinaryData, randomUUID, stringToUint8Array, uint8ArrayToString } from "../../binary";
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
function createMessage(data: string | ArrayBuffer): WebSocketMessage {
  const isText = typeof data === "string";

  let binaryData: BinaryData;
  let textData: string;

  if (typeof data === "string") {
    textData = data;
    binaryData = stringToUint8Array(data);
  } else {
    binaryData = new Uint8Array(data);
    textData = uint8ArrayToString(binaryData);
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

    this.ws.send(data);
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
    this.ws.addEventListener(event, handler as EventListener);
  }

  unsubscribe(event: string, handler: (...args: unknown[]) => void): void {
    this.ws.removeEventListener(event, handler as EventListener);
  }

  getRaw(): WebSocket {
    return this.ws;
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
  private cancelConnection: (() => void) | null = null;

  constructor(options: WebSocketAdapterOptions) {
    this.options = options;
    this.hooks = options.hooks ?? {};
  }

  async connect(): Promise<WebSocketPeer> {
    return new Promise((resolve, reject) => {
      try {
        const socket = new WebSocket(this.options.url, this.options.protocols);
        this.ws = socket;
        socket.binaryType = "arraybuffer";
        this.peer = new BrowserWebSocketPeer(socket, this.options.url);
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timeoutId);
          this.cancelConnection = null;
          reject(error);
        };
        this.cancelConnection = () => fail(new Error("WebSocket connection canceled"));

        // Setup timeout
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
        if (this.options.timeout) {
          timeoutId = globalThis.setTimeout(() => {
            if (socket.readyState === ReadyState.CONNECTING) {
              fail(new Error("WebSocket connection timeout"));
              socket.close();
            }
          }, this.options.timeout);
        }

        // Setup event handlers
        const peer = this.peer;

        socket.onopen = () => {
          if (settled) return;
          settled = true;
          globalThis.clearTimeout(timeoutId);
          this.cancelConnection = null;
          resolve(peer);
          this.hooks.open?.(peer);
        };

        socket.onmessage = (event) => {
          if (peer) {
            const message = createMessage(event.data);
            this.hooks.message?.(peer, message);
          }
        };

        socket.onclose = (event) => {
          fail(new Error(`WebSocket closed before opening: ${event.code}`));
          if (peer) {
            const closeEvent: WebSocketCloseEvent = {
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean,
            };
            this.hooks.close?.(peer, closeEvent);
          }
        };

        socket.onerror = (_event) => {
          fail(new Error("WebSocket connection failed"));
          if (peer) {
            const errorEvent = {
              message: "WebSocket error",
              error: new Error("WebSocket error"),
            };
            this.hooks.error?.(peer, errorEvent);
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
    this.cancelConnection?.();
    this.cancelConnection = null;
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
export function createBrowserWebSocketAdapter(
  options: WebSocketAdapterOptions
): BrowserWebSocketAdapter {
  return new BrowserWebSocketAdapter(options);
}
