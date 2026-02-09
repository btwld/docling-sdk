/**
 * Node.js WebSocket adapter
 * Uses the 'ws' library for Node.js environments
 */

import { type BinaryData, randomUUID, stringToUint8Array, uint8ArrayToString } from "../../binary";
import { isNode } from "../../detection";
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

// Dynamic import type for ws
type WsWebSocket = {
  readyState: number;
  protocol: string;
  send(data: string | Buffer | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(data?: Buffer | Uint8Array): void;
  pong(data?: Buffer | Uint8Array): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
};

type WsModule = {
  default: new (url: string, protocols?: string | string[]) => WsWebSocket;
};

let wsModule: WsModule | null = null;

/**
 * Lazy load ws module (only in Node.js)
 */
async function getWsModule(): Promise<WsModule> {
  if (wsModule) return wsModule;

  if (!isNode()) {
    throw new Error("Node.js WebSocket adapter can only be used in Node.js environment");
  }

  try {
    // Dynamic import of ws
    wsModule = (await import("ws")) as WsModule;
    return wsModule;
  } catch {
    throw new Error(
      "ws package is required for Node.js WebSocket support. Install it with: npm install ws"
    );
  }
}

/**
 * Create a WebSocket message wrapper
 */
function createMessage(data: string | Buffer | ArrayBuffer | Uint8Array): WebSocketMessage {
  const isText = typeof data === "string";

  let binaryData: BinaryData;
  let textData: string;

  if (typeof data === "string") {
    textData = data;
    binaryData = stringToUint8Array(data);
  } else if (data instanceof ArrayBuffer) {
    binaryData = new Uint8Array(data);
    textData = uint8ArrayToString(binaryData);
  } else if (data instanceof Uint8Array) {
    binaryData = data;
    textData = uint8ArrayToString(data);
  } else {
    // Buffer
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
 * Node.js WebSocket peer implementation
 */
class NodeWebSocketPeer implements WebSocketPeer {
  readonly id: string;
  readonly url: string;
  private ws: WsWebSocket;

  constructor(ws: WsWebSocket, url: string) {
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

  ping(data?: BinaryData): void {
    this.ws.ping(data);
  }

  pong(data?: BinaryData): void {
    this.ws.pong(data);
  }

  terminate(): void {
    this.ws.terminate();
  }

  subscribe(event: string, handler: (...args: unknown[]) => void): void {
    this.ws.on(event, handler);
  }

  unsubscribe(event: string, handler: (...args: unknown[]) => void): void {
    this.ws.off(event, handler);
  }

  getRaw(): WsWebSocket {
    return this.ws;
  }
}

/**
 * Node.js WebSocket adapter
 */
export class NodeWebSocketAdapter implements WebSocketAdapter {
  private options: WebSocketAdapterOptions;
  private hooks: WebSocketHooks;
  private peer: NodeWebSocketPeer | null = null;
  private ws: WsWebSocket | null = null;

  constructor(options: WebSocketAdapterOptions) {
    this.options = options;
    this.hooks = options.hooks ?? {};
  }

  async connect(): Promise<WebSocketPeer> {
    const WsModule = await getWsModule();
    const WebSocket = WsModule.default;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url, this.options.protocols);
        this.peer = new NodeWebSocketPeer(this.ws, this.options.url);

        // Setup timeout
        let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
        if (this.options.timeout) {
          timeoutId = globalThis.setTimeout(() => {
            if (this.ws?.readyState === ReadyState.CONNECTING) {
              this.ws.terminate();
              reject(new Error("WebSocket connection timeout"));
            }
          }, this.options.timeout);
        }

        // Setup event handlers
        const peer = this.peer;

        this.ws.on("open", () => {
          if (timeoutId) globalThis.clearTimeout(timeoutId);
          if (peer) {
            this.hooks.open?.(peer);
            resolve(peer);
          }
        });

        this.ws.on("message", ((data: string | Buffer | ArrayBuffer) => {
          if (peer) {
            const message = createMessage(data);
            this.hooks.message?.(peer, message);
          }
        }) as (...args: unknown[]) => void);

        this.ws.on("close", ((code: number, reason: Buffer) => {
          if (timeoutId) globalThis.clearTimeout(timeoutId);
          if (peer) {
            const closeEvent: WebSocketCloseEvent = {
              code,
              reason: reason.toString(),
              wasClean: code === 1000,
            };
            this.hooks.close?.(peer, closeEvent);
          }
        }) as (...args: unknown[]) => void);

        this.ws.on("error", ((error: Error) => {
          if (timeoutId) globalThis.clearTimeout(timeoutId);
          if (peer) {
            const errorEvent = {
              message: error.message,
              error,
            };
            this.hooks.error?.(peer, errorEvent);
          }
          if (this.ws?.readyState === ReadyState.CONNECTING) {
            reject(error);
          }
        }) as (...args: unknown[]) => void);

        this.ws.on("ping", ((data: Buffer) => {
          if (peer) {
            this.hooks.ping?.(peer, new Uint8Array(data));
          }
        }) as (...args: unknown[]) => void);

        this.ws.on("pong", ((data: Buffer) => {
          if (peer) {
            this.hooks.pong?.(peer, new Uint8Array(data));
          }
        }) as (...args: unknown[]) => void);
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
    return "node";
  }
}

/**
 * Create a Node.js WebSocket adapter
 */
export function createNodeWebSocketAdapter(options: WebSocketAdapterOptions): NodeWebSocketAdapter {
  return new NodeWebSocketAdapter(options);
}
