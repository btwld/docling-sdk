/**
 * Cross-runtime WebSocket module
 * Auto-selects the appropriate adapter based on runtime environment
 */

import { hasNativeWebSocket, isNode } from "../detection";
import type {
  WebSocketAdapter,
  WebSocketAdapterOptions,
  WebSocketHooks,
  WebSocketPeer,
} from "./types";

// Re-export types
export type {
  WebSocketAdapter,
  WebSocketAdapterOptions,
  WebSocketCloseEvent,
  WebSocketErrorEvent,
  WebSocketHooks,
  WebSocketMessage,
  WebSocketMessageEvent,
  WebSocketPeer,
} from "./types";

// Re-export type separately (for use in type contexts)
export type { WebSocketAdapterFactory, WebSocketReadyState as WebSocketReadyStateType } from "./types";

// Lazy-loaded adapters
let browserAdapter: typeof import("./adapters/browser") | null = null;
let nodeAdapter: typeof import("./adapters/node") | null = null;

/**
 * Get the browser adapter (lazy-loaded)
 */
async function getBrowserAdapter() {
  if (!browserAdapter) {
    browserAdapter = await import("./adapters/browser");
  }
  return browserAdapter;
}

/**
 * Get the Node.js adapter (lazy-loaded)
 */
async function getNodeAdapter() {
  if (!nodeAdapter) {
    nodeAdapter = await import("./adapters/node");
  }
  return nodeAdapter;
}

/**
 * Create a WebSocket adapter based on the current runtime
 * Automatically selects the best adapter for the environment
 */
export async function createWebSocketAdapter(
  options: WebSocketAdapterOptions
): Promise<WebSocketAdapter> {
  // In Node.js, use the ws-based adapter
  if (isNode()) {
    const adapter = await getNodeAdapter();
    return adapter.createNodeWebSocketAdapter(options);
  }

  // In browser/Deno/Bun, use native WebSocket
  if (hasNativeWebSocket()) {
    const adapter = await getBrowserAdapter();
    return adapter.createBrowserWebSocketAdapter(options);
  }

  throw new Error("No WebSocket implementation available in this environment");
}

/**
 * Cross-runtime WebSocket client
 * Provides a unified interface for WebSocket across all environments
 */
export class CrossWebSocket {
  private adapter: WebSocketAdapter | null = null;
  private options: WebSocketAdapterOptions;
  private hooks: WebSocketHooks;
  private connectionPromise: Promise<WebSocketPeer> | null = null;

  constructor(url: string, options: Omit<WebSocketAdapterOptions, "url"> = {}) {
    this.options = { ...options, url };
    this.hooks = options.hooks ?? {};
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<WebSocketPeer> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      this.adapter = await createWebSocketAdapter({
        ...this.options,
        hooks: this.hooks,
      });
      return this.adapter.connect();
    })();

    try {
      return await this.connectionPromise;
    } catch (error) {
      this.connectionPromise = null;
      throw error;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.adapter?.isConnected() ?? false;
  }

  /**
   * Get the current peer
   */
  getPeer(): WebSocketPeer | null {
    return this.adapter?.getPeer() ?? null;
  }

  /**
   * Send data
   */
  send(data: string | Uint8Array): void {
    const peer = this.getPeer();
    if (!peer) {
      throw new Error("WebSocket is not connected");
    }
    peer.send(data);
  }

  /**
   * Send text data
   */
  sendText(data: string): void {
    const peer = this.getPeer();
    if (!peer) {
      throw new Error("WebSocket is not connected");
    }
    peer.sendText(data);
  }

  /**
   * Send JSON data
   */
  sendJson(data: unknown): void {
    this.sendText(JSON.stringify(data));
  }

  /**
   * Close the connection
   */
  close(code = 1000, reason = ""): void {
    this.adapter?.close(code, reason);
    this.adapter = null;
    this.connectionPromise = null;
  }

  /**
   * Set event hooks
   */
  setHooks(hooks: WebSocketHooks): void {
    this.hooks = hooks;
    this.adapter?.setHooks(hooks);
  }

  /**
   * Add a hook handler
   */
  on<K extends keyof WebSocketHooks>(
    event: K,
    handler: NonNullable<WebSocketHooks[K]>
  ): this {
    this.hooks[event] = handler as WebSocketHooks[K];
    this.adapter?.setHooks(this.hooks);
    return this;
  }

  /**
   * Remove a hook handler
   */
  off<K extends keyof WebSocketHooks>(event: K): this {
    delete this.hooks[event];
    this.adapter?.setHooks(this.hooks);
    return this;
  }

  /**
   * Get the adapter type
   */
  getAdapterType(): "browser" | "node" | "universal" | null {
    return this.adapter?.getType() ?? null;
  }

  /**
   * Get the underlying adapter
   */
  getAdapter(): WebSocketAdapter | null {
    return this.adapter;
  }
}

/**
 * Create a cross-runtime WebSocket client
 */
export function createCrossWebSocket(
  url: string,
  options: Omit<WebSocketAdapterOptions, "url"> = {}
): CrossWebSocket {
  return new CrossWebSocket(url, options);
}

/**
 * Simple WebSocket connection helper
 * Returns a promise that resolves with the peer when connected
 */
export async function connectWebSocket(
  url: string,
  hooks?: WebSocketHooks,
  options?: Omit<WebSocketAdapterOptions, "url" | "hooks">
): Promise<WebSocketPeer> {
  const ws = new CrossWebSocket(url, { ...options, hooks });
  return ws.connect();
}
