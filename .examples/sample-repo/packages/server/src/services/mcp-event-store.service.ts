import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  EventStore,
  EventId,
  StreamId,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';

/**
 * In-memory implementation of EventStore for StreamableHTTP resumability
 *
 * For production use, consider implementing a persistent store using Redis or a database
 */
@Injectable()
export class McpEventStoreService implements EventStore, OnModuleDestroy {
  private readonly logger = new Logger(McpEventStoreService.name);

  private readonly events = new Map<
    EventId,
    { streamId: StreamId; message: JSONRPCMessage; timestamp: number }
  >();
  private readonly streamEvents = new Map<StreamId, Set<EventId>>();

  private readonly maxEventsPerStream = 1000;

  private readonly maxEventAge = 60 * 60 * 1000;

  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTask();
    this.logger.log('Event store initialized with resumability support');
  }

  /**
   * Clean up resources when the module is destroyed
   */
  onModuleDestroy(): void {
    this.stopCleanupTask();
    this.logger.log('Event store cleanup stopped');
  }

  /**
   * Store an event for later retrieval
   * @param streamId Stream ID
   * @param message JSON-RPC message
   * @returns Event ID
   */
  async storeEvent(
    streamId: StreamId,
    message: JSONRPCMessage,
  ): Promise<EventId> {
    const timestamp = Date.now();
    const eventId = `${streamId}_${randomUUID()}_${timestamp}`;

    this.events.set(eventId, { streamId, message, timestamp });

    if (!this.streamEvents.has(streamId)) {
      this.streamEvents.set(streamId, new Set());
    }

    const streamEventSet = this.streamEvents.get(streamId);
    if (streamEventSet) {
      streamEventSet.add(eventId);
    }

    this.enforceMaxEventsPerStream(streamId);

    this.logger.debug(`Stored event ${eventId} for stream ${streamId}`);
    return eventId;
  }

  /**
   * Replay events that occurred after the specified event ID
   * @param lastEventId Last event ID
   * @param options Options for replaying events
   * @returns Stream ID
   */
  async replayEventsAfter(
    lastEventId: EventId,
    {
      send,
    }: {
      send: (eventId: EventId, message: JSONRPCMessage) => Promise<void>;
    },
  ): Promise<StreamId> {
    const streamId = lastEventId.split('_')[0];

    this.logger.debug(
      `Replaying events after ${lastEventId} for stream ${streamId}`,
    );

    const streamEventIds = this.streamEvents.get(streamId);
    if (!streamEventIds) {
      this.logger.warn(`No events found for stream ${streamId}`);
      return streamId;
    }

    const eventIds = Array.from(streamEventIds).sort((a, b) => {
      const timestampA = parseInt(a.split('_')[2] || '0', 10);
      const timestampB = parseInt(b.split('_')[2] || '0', 10);
      return timestampA - timestampB;
    });

    const lastEventIndex = eventIds.indexOf(lastEventId);

    if (lastEventIndex === -1) {
      this.logger.warn(`Event ${lastEventId} not found in stream ${streamId}`);
      return streamId;
    }

    let replayCount = 0;
    for (let i = lastEventIndex + 1; i < eventIds.length; i++) {
      const eventId = eventIds[i];
      const event = this.events.get(eventId);

      if (event) {
        await send(eventId, event.message);
        replayCount++;
      }
    }

    this.logger.debug(`Replayed ${replayCount} events for stream ${streamId}`);
    return streamId;
  }

  /**
   * Enforce maximum events per stream by removing oldest events
   * @param streamId Stream ID
   */
  private enforceMaxEventsPerStream(streamId: StreamId): void {
    const streamEventIds = this.streamEvents.get(streamId);
    if (!streamEventIds || streamEventIds.size <= this.maxEventsPerStream) {
      return;
    }

    const eventsToRemove = streamEventIds.size - this.maxEventsPerStream;

    const eventIds = Array.from(streamEventIds).sort((a, b) => {
      const eventA = this.events.get(a);
      const eventB = this.events.get(b);

      if (!eventA || !eventB) {
        return 0;
      }

      return (eventA.timestamp || 0) - (eventB.timestamp || 0);
    });

    let removedCount = 0;
    for (let i = 0; i < eventsToRemove; i++) {
      const eventId = eventIds[i];
      if (streamEventIds.delete(eventId)) {
        this.events.delete(eventId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.debug(
        `Removed ${removedCount} oldest events from stream ${streamId}`,
      );
    }
  }

  /**
   * Start a periodic cleanup task to remove old events
   */
  private startCleanupTask(): void {
    this.cleanupInterval = setInterval(
      () => {
        this.cleanupOldEvents();
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Stop the cleanup task
   */
  private stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up old events
   */
  private cleanupOldEvents(): void {
    const now = Date.now();
    const cutoff = now - this.maxEventAge;

    let removedCount = 0;
    const affectedStreams = new Set<StreamId>();

    for (const [eventId, event] of this.events.entries()) {
      if (event.timestamp < cutoff) {
        this.events.delete(eventId);
        removedCount++;

        const streamEvents = this.streamEvents.get(event.streamId);
        if (streamEvents) {
          streamEvents.delete(eventId);
          affectedStreams.add(event.streamId);

          if (streamEvents.size === 0) {
            this.streamEvents.delete(event.streamId);
          }
        }
      }
    }

    if (removedCount > 0) {
      this.logger.debug(
        `Cleaned up ${removedCount} old events from ${affectedStreams.size} streams`,
      );
    }
  }
}
