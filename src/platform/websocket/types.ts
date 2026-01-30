/**
 * WebSocket adapter types (crossws-style)
 * Provides a unified interface for WebSocket across all runtimes
 */

import type { BinaryData } from "../binary";

/**
 * WebSocket ready states (matching W3C WebSocket spec)
 */
export const WebSocketReadyState = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type WebSocketReadyState = (typeof WebSocketReadyState)[keyof typeof WebSocketReadyState];

/**
 * WebSocket close event
 */
export interface WebSocketCloseEvent {
  /** Close code */
  code: number;
  /** Close reason */
  reason: string;
  /** Whether the connection was closed cleanly */
  wasClean: boolean;
}

/**
 * WebSocket message event
 */
export interface WebSocketMessageEvent {
  /** Message data */
  data: string | BinaryData;
  /** Message type */
  type: "text" | "binary";
}

/**
 * WebSocket error event
 */
export interface WebSocketErrorEvent {
  /** Error message */
  message: string;
  /** Original error */
  error?: Error;
}

/**
 * WebSocket peer - represents a WebSocket connection (crossws-style)
 */
export interface WebSocketPeer {
  /** Unique identifier for this peer */
  id: string;
  /** WebSocket URL */
  url: string;
  /** WebSocket ready state */
  readyState: WebSocketReadyState;
  /** WebSocket protocol */
  protocol: string;
  /** Send data to the peer */
  send(data: string | BinaryData): void;
  /** Send text data */
  sendText(data: string): void;
  /** Send binary data */
  sendBinary(data: BinaryData): void;
  /** Close the connection */
  close(code?: number, reason?: string): void;
  /** Ping the peer (if supported) */
  ping?(data?: BinaryData): void;
  /** Pong the peer (if supported) */
  pong?(data?: BinaryData): void;
  /** Subscribe to events (internal) */
  subscribe(event: string, handler: (...args: unknown[]) => void): void;
  /** Unsubscribe from events (internal) */
  unsubscribe(event: string, handler: (...args: unknown[]) => void): void;
  /** Terminate connection immediately */
  terminate(): void;
  /** Get underlying WebSocket (runtime-specific) */
  getRaw(): unknown;
}

/**
 * WebSocket message wrapper
 */
export interface WebSocketMessage {
  /** Raw data */
  data: string | BinaryData;
  /** Message type */
  type: "text" | "binary";
  /** Parse data as JSON */
  json<T = unknown>(): T;
  /** Get data as text */
  text(): string;
  /** Get data as binary */
  binary(): BinaryData;
}

/**
 * WebSocket hooks (crossws-style)
 */
export interface WebSocketHooks {
  /** Called when connection opens */
  open?: (peer: WebSocketPeer) => void | Promise<void>;
  /** Called when a message is received */
  message?: (peer: WebSocketPeer, message: WebSocketMessage) => void | Promise<void>;
  /** Called when connection closes */
  close?: (peer: WebSocketPeer, event: WebSocketCloseEvent) => void | Promise<void>;
  /** Called when an error occurs */
  error?: (peer: WebSocketPeer, error: WebSocketErrorEvent) => void | Promise<void>;
  /** Called on ping (if supported) */
  ping?: (peer: WebSocketPeer, data?: BinaryData) => void | Promise<void>;
  /** Called on pong (if supported) */
  pong?: (peer: WebSocketPeer, data?: BinaryData) => void | Promise<void>;
}

/**
 * WebSocket adapter options
 */
export interface WebSocketAdapterOptions {
  /** WebSocket URL */
  url: string;
  /** WebSocket subprotocols */
  protocols?: string | string[];
  /** Connection timeout (ms) */
  timeout?: number;
  /** Hooks */
  hooks?: WebSocketHooks;
}

/**
 * WebSocket adapter interface
 */
export interface WebSocketAdapter {
  /** Connect to WebSocket server */
  connect(): Promise<WebSocketPeer>;
  /** Check if connected */
  isConnected(): boolean;
  /** Get current peer */
  getPeer(): WebSocketPeer | null;
  /** Close connection */
  close(code?: number, reason?: string): void;
  /** Update hooks */
  setHooks(hooks: WebSocketHooks): void;
  /** Get current hooks */
  getHooks(): WebSocketHooks;
  /** Get adapter type */
  getType(): "browser" | "node" | "universal";
}

/**
 * WebSocket adapter factory
 */
export type WebSocketAdapterFactory = (options: WebSocketAdapterOptions) => WebSocketAdapter;
