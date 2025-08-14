import { Injectable, Logger } from '@nestjs/common';
import { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

/**
 * Service for managing MCP logging
 */
@Injectable()
export class McpLoggingService {
  private readonly logger = new Logger(McpLoggingService.name);
  private logLevel: LoggingLevel = 'info';

  constructor() {
    this.logger.log(`Initialized with default log level: ${this.logLevel}`);
  }

  /**
   * Get the current log level
   * @returns The current log level
   */
  getLogLevel(): LoggingLevel {
    return this.logLevel;
  }

  /**
   * Set the log level
   * @param level The new log level
   */
  setLogLevel(level: LoggingLevel): void {
    this.logger.log(`Setting log level to: ${level}`);
    this.logLevel = level;
  }

  /**
   * Check if a message at the given level should be logged
   * @param level The level of the message
   * @returns True if the message should be logged
   */
  shouldLog(level: LoggingLevel): boolean {
    const levels: LoggingLevel[] = [
      'debug',
      'info',
      'notice',
      'warning',
      'error',
      'critical',
      'alert',
      'emergency',
    ];

    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    // Log the message if its level is equal to or higher than the current level
    return messageLevelIndex >= currentLevelIndex;
  }
}
