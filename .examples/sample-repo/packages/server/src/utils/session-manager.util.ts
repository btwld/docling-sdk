/**
 * Session management utilities
 */
import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'crypto';

/**
 * Session data interface
 * @template T Transport type
 * @template D Additional data type
 */
export interface SessionData<T = unknown, D = Record<string, unknown>> {
  /**
   * Session ID
   */
  id: string;

  /**
   * Transport instance
   */
  transport: T;

  /**
   * MCP server instance
   */
  server: McpServer;

  /**
   * Last activity timestamp
   */
  lastActivity: number;

  /**
   * Additional session data
   */
  data?: D;
}

/**
 * Session manager options
 */
export interface SessionManagerOptions {
  /**
   * Session timeout in milliseconds
   * @default 1800000 (30 minutes)
   */
  sessionTimeout?: number;

  /**
   * Session ID generator function
   * @default () => randomUUID()
   */
  sessionIdGenerator?: () => string;

  /**
   * Cleanup interval in milliseconds
   * @default 60000 (1 minute)
   */
  cleanupInterval?: number;

  /**
   * Logger instance
   */
  logger?: Logger;

  /**
   * Callback to run when a session is closed
   */
  onSessionClosed?: (sessionId: string) => void;

  /**
   * Test mode session ID
   * @default 'test-session-id'
   */
  testSessionId?: string;
}

/**
 * Session manager class for handling session lifecycle
 * @template T Transport type
 * @template D Additional data type
 */
export class SessionManager<T = unknown, D = Record<string, unknown>> {
  private readonly sessions = new Map<string, SessionData<T, D>>();
  private readonly sessionTimeout: number;
  private readonly sessionIdGenerator: () => string;
  private readonly logger: Logger;
  private readonly cleanupInterval: number;
  private readonly onSessionClosed?: (sessionId: string) => void;
  private readonly testSessionId: string;
  private cleanupIntervalId?: NodeJS.Timeout;

  /**
   * Create a new session manager
   * @param options Session manager options
   */
  constructor(options: SessionManagerOptions = {}) {
    this.sessionTimeout = options.sessionTimeout || 1800000;
    this.sessionIdGenerator =
      options.sessionIdGenerator || (() => randomUUID());
    this.cleanupInterval = options.cleanupInterval || 60000;
    this.logger = options.logger || new Logger('SessionManager');
    this.onSessionClosed = options.onSessionClosed;
    this.testSessionId = options.testSessionId || 'test-session-id';

    this.startCleanupInterval();
  }

  /**
   * Create a new session
   * @param transport Transport instance
   * @param server MCP server instance
   * @param additionalData Additional session data
   * @returns Session ID
   */
  createSession(
    transport: T,
    server: McpServer,
    additionalData: D = {} as D,
  ): string {
    // Check if this is a test session
    const isTestSession =
      Object.prototype.hasOwnProperty.call(additionalData, 'isTestSession') &&
      (additionalData as Record<string, unknown>).isTestSession === true;
    const sessionId = isTestSession
      ? this.testSessionId
      : this.sessionIdGenerator();

    if (isTestSession && this.sessions.has(sessionId)) {
      this.logger.debug(`Replacing existing test session: ${sessionId}`);

      const existingSession = this.sessions.get(sessionId);

      this.sessions.delete(sessionId);

      if (existingSession) {
        try {
          void existingSession.server.close();
        } catch (error) {
          this.logger.warn(
            `Error closing existing test session: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    this.sessions.set(sessionId, {
      id: sessionId,
      transport,
      server,
      lastActivity: Date.now(),
      data: additionalData,
    });

    this.logger.debug(
      `Created session: ${sessionId}${isTestSession ? ' (test)' : ''}`,
    );
    return sessionId;
  }

  /**
   * Get a session by ID
   * @param sessionId Session ID
   * @returns Session data or undefined if not found
   */
  getSession(sessionId: string): SessionData<T, D> | undefined {
    const session = this.sessions.get(sessionId);

    if (session) {
      session.lastActivity = Date.now();
    }

    return session;
  }

  /**
   * Update a session's last activity timestamp
   * @param sessionId Session ID
   * @returns True if the session was found and updated
   */
  updateSessionActivity(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);

    if (session) {
      session.lastActivity = Date.now();
      return true;
    }

    return false;
  }

  /**
   * Close and remove a session
   * @param sessionId Session ID
   * @returns True if the session was found and removed
   */
  closeSession(sessionId: string): boolean {
    if (this._closingSessions.has(sessionId)) {
      return true;
    }

    const session = this.sessions.get(sessionId);

    if (session) {
      try {
        this._closingSessions.add(sessionId);

        this.sessions.delete(sessionId);

        try {
          void session.server.close();
        } catch (serverError) {
          this.logger.warn(
            `Error closing server for session ${sessionId}: ${serverError instanceof Error ? serverError.message : String(serverError)}`,
          );
        }

        if (this.onSessionClosed) {
          this.onSessionClosed(sessionId);
        }

        this.logger.debug(`Closed session: ${sessionId}`);

        this._closingSessions.delete(sessionId);

        return true;
      } catch (error) {
        this._closingSessions.delete(sessionId);

        this.logger.error(
          `Error closing session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    }

    return false;
  }

  private readonly _closingSessions = new Set<string>();

  /**
   * Check if a session exists
   * @param sessionId Session ID
   * @returns True if the session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get the number of active sessions
   * @returns Number of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get all session IDs
   * @returns Array of session IDs
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Start the cleanup interval
   */
  private startCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.cleanupInterval);
  }

  /**
   * Clean up inactive sessions
   */
  private cleanupInactiveSessions(): void {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.sessionTimeout) {
        this.logger.debug(
          `Session ${sessionId} timed out after ${this.sessionTimeout}ms of inactivity`,
        );
        this.closeSession(sessionId);
      }
    }
  }

  /**
   * Stop the cleanup interval
   */
  stopCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
  }

  /**
   * Close all sessions
   */
  closeAllSessions(): void {
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }
  }

  /**
   * Dispose of the session manager
   * Stops the cleanup interval and closes all sessions
   */
  dispose(): void {
    this.stopCleanupInterval();
    this.closeAllSessions();
  }
}
