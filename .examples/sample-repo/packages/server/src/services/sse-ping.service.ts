import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { McpOptions } from '../interfaces/mcp-options.interface';
import { McpTransportType } from '../types/common';

/**
 * Service for sending periodic ping messages to SSE clients
 * to keep the connection alive
 */
@Injectable()
export class SsePingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SsePingService.name);
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly pingIntervalMs: number;
  private readonly pingEnabled: boolean;

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.pingEnabled = options.sse?.pingEnabled !== false;
    this.pingIntervalMs = options.sse?.pingIntervalMs || 30000;
  }

  /**
   * Initialize the ping service
   */
  onModuleInit() {
    const transports = Array.isArray(this.options.transport)
      ? this.options.transport
      : [this.options.transport];

    if (this.pingEnabled && transports.includes(McpTransportType.SSE)) {
      this.startPingInterval();
    }
  }

  /**
   * Clean up the ping service
   */
  onModuleDestroy() {
    this.stopPingInterval();
  }

  /**
   * Start sending periodic ping messages
   */
  startPingInterval() {
    this.logger.log(`Starting SSE ping interval (${this.pingIntervalMs}ms)`);

    this.stopPingInterval();

    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, this.pingIntervalMs);
  }

  /**
   * Stop sending periodic ping messages
   */
  stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
      this.logger.log('Stopped SSE ping interval');
    }
  }

  /**
   * Send a ping message to all SSE clients
   */
  sendPing() {
    try {
      this.eventEmitter.emit('sse.ping', {
        timestamp: new Date().toISOString(),
      });

      this.logger.debug('Sent SSE ping');
    } catch (error) {
      this.logger.error('Failed to send SSE ping', error);
    }
  }
}
