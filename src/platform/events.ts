/**
 * Cross-runtime event emitter based on mitt
 * Provides a lightweight EventEmitter replacement (~200 bytes)
 */

import mitt, { type Emitter, type Handler, type WildcardHandler } from "mitt";

/**
 * Generic event map type - must be indexable by string
 */
export type EventMap = Record<string, unknown>;

/**
 * Type-safe event handler
 */
export type EventHandler<T = unknown> = Handler<T>;

/**
 * Wildcard event handler
 */
export type WildcardEventHandler<Events extends EventMap> = WildcardHandler<Events>;

/**
 * Cross-runtime EventEmitter adapter
 * Wraps mitt to provide a familiar Node.js-like interface
 */
export class CrossEventEmitter<Events extends EventMap = EventMap> {
  private emitter: Emitter<Events>;

  constructor() {
    this.emitter = mitt<Events>();
  }

  /**
   * Register an event handler
   */
  on<Key extends keyof Events>(type: Key, handler: EventHandler<Events[Key]>): this {
    this.emitter.on(type, handler as Handler<Events[Key]>);
    return this;
  }

  /**
   * Remove an event handler
   */
  off<Key extends keyof Events>(type: Key, handler?: EventHandler<Events[Key]>): this {
    this.emitter.off(type, handler as Handler<Events[Key]>);
    return this;
  }

  /**
   * Emit an event with data
   */
  emit<Key extends keyof Events>(type: Key, event: Events[Key]): this {
    this.emitter.emit(type, event);
    return this;
  }

  /**
   * Register a one-time event handler
   */
  once<Key extends keyof Events>(type: Key, handler: EventHandler<Events[Key]>): this {
    const onceHandler = ((event: Events[Key]) => {
      this.off(type, onceHandler as EventHandler<Events[Key]>);
      (handler as Handler<Events[Key]>)(event);
    }) as EventHandler<Events[Key]>;

    return this.on(type, onceHandler);
  }

  /**
   * Register a wildcard event handler (receives all events)
   */
  onAny(handler: WildcardEventHandler<Events>): this {
    this.emitter.on("*", handler);
    return this;
  }

  /**
   * Remove a wildcard event handler
   */
  offAny(handler?: WildcardEventHandler<Events>): this {
    if (handler) {
      this.emitter.off("*", handler);
    } else {
      // Remove all wildcard handlers by clearing them
      const wildcardHandlers = this.emitter.all.get("*");
      if (wildcardHandlers) {
        wildcardHandlers.length = 0;
      }
    }
    return this;
  }

  /**
   * Remove all event handlers
   */
  removeAllListeners<Key extends keyof Events>(type?: Key): this {
    if (type !== undefined) {
      this.emitter.off(type);
    } else {
      this.emitter.all.clear();
    }
    return this;
  }

  /**
   * Get all event handlers for a specific event
   */
  listeners<Key extends keyof Events>(type: Key): Array<EventHandler<Events[Key]>> {
    return (this.emitter.all.get(type) as Array<EventHandler<Events[Key]>>) || [];
  }

  /**
   * Get count of listeners for a specific event
   */
  listenerCount<Key extends keyof Events>(type: Key): number {
    return this.listeners(type).length;
  }

  /**
   * Check if event has listeners
   */
  hasListeners<Key extends keyof Events>(type: Key): boolean {
    return this.listenerCount(type) > 0;
  }

  /**
   * Get all event names that have registered handlers
   */
  eventNames(): Array<keyof Events> {
    return Array.from(this.emitter.all.keys()) as Array<keyof Events>;
  }

  /**
   * Alias for on() - Node.js compatibility
   */
  addListener<Key extends keyof Events>(type: Key, handler: EventHandler<Events[Key]>): this {
    return this.on(type, handler);
  }

  /**
   * Alias for off() - Node.js compatibility
   */
  removeListener<Key extends keyof Events>(type: Key, handler: EventHandler<Events[Key]>): this {
    return this.off(type, handler);
  }

  /**
   * Get the underlying mitt emitter
   */
  getRawEmitter(): Emitter<Events> {
    return this.emitter;
  }
}

/**
 * Create a new CrossEventEmitter instance
 */
export function createEventEmitter<
  Events extends EventMap = EventMap,
>(): CrossEventEmitter<Events> {
  return new CrossEventEmitter<Events>();
}

// Re-export mitt for advanced usage
export { mitt };
