/**
 * WebSocket client for real-time Docling task monitoring
 * Uses cross-runtime WebSocket adapters
 */

import { CrossEventEmitter } from "../platform/events";
import { delay } from "../platform/timers";
import { CrossWebSocket, type WebSocketHooks } from "../platform/websocket";
import { DoclingNetworkError, DoclingTimeoutError } from "../types";
import type {
  ProcessingError,
  TaskStatus,
  TaskStatusResponse,
  WebSocketMessage,
} from "../types/api";

/**
 * WebSocket client configuration
 */
export interface WebSocketConfig {
  baseUrl: string;
  timeout?: number;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  heartbeatInterval?: number;
}

/**
 * WebSocket connection states
 */
export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

/**
 * WebSocket events
 */
interface DoclingWebSocketEvents {
  [key: string]: unknown;
  connecting: string;
  connected: string;
  disconnected: { code: number; reason: string };
  error: Error;
  connection: WebSocketMessage;
  taskUpdate: TaskStatusResponse;
  task_update: WebSocketMessage;
  taskComplete: TaskStatusResponse;
  taskFailed: TaskStatusResponse;
  taskStarted: TaskStatusResponse;
  taskError: ProcessingError;
  unknownMessage: WebSocketMessage;
  reconnecting: { attempt: number; delay: number };
  reconnectFailed: { attempt: number; error: unknown };
  progress: {
    stage: string;
    percentage?: number;
    message?: string;
    taskId: string;
    position?: number;
    status?: string;
    timestamp: number;
  };
  status: [string, string];
}

/**
 * WebSocket client for task monitoring
 */
export class DoclingWebSocketClient extends CrossEventEmitter<DoclingWebSocketEvents> {
  private config: Required<WebSocketConfig>;
  private ws: CrossWebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private reconnectAbortController: AbortController | null = null;
  private _currentTaskId: string | null = null;

  constructor(config: WebSocketConfig) {
    super();

    this.config = {
      baseUrl: config.baseUrl,
      timeout: config.timeout || 30000,
      reconnectAttempts: config.reconnectAttempts || 3,
      reconnectDelay: config.reconnectDelay || 5000,
      heartbeatInterval: config.heartbeatInterval || 30000,
    };

    this.config.baseUrl = this.config.baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

    if (this.config.baseUrl.endsWith("/")) {
      this.config.baseUrl = this.config.baseUrl.slice(0, -1);
    }
  }

  /**
   * Connect to WebSocket for task monitoring
   */
  async connectToTask(taskId: string): Promise<void> {
    const url = `${this.config.baseUrl}/v1/status/ws/${taskId}`;
    this._currentTaskId = taskId;

    return new Promise((resolve, reject) => {
      try {
        this.connectionState = "connecting";
        this.emit("connecting", taskId);

        // Create timeout controller
        let timeoutResolved = false;
        const timeoutId = globalThis.setTimeout(() => {
          if (!timeoutResolved && this.connectionState === "connecting") {
            this.ws?.close();
            reject(new DoclingTimeoutError(this.config.timeout, "WebSocket connection"));
          }
        }, this.config.timeout);

        const hooks: WebSocketHooks = {
          open: () => {
            timeoutResolved = true;
            globalThis.clearTimeout(timeoutId);
            this.connectionState = "connected";
            this.reconnectAttempts = 0;
            this.startHeartbeat();
            this.emit("connected", taskId);
            resolve();
          },

          message: (_peer, message) => {
            try {
              const parsed: WebSocketMessage = message.json();
              this.handleMessage(parsed);
            } catch (error) {
              this.emit("error", new Error(`Failed to parse WebSocket message: ${error}`));
            }
          },

          close: (_peer, event) => {
            timeoutResolved = true;
            globalThis.clearTimeout(timeoutId);
            this.connectionState = "disconnected";
            this.stopHeartbeat();
            this.emit("disconnected", { code: event.code, reason: event.reason });

            if (event.code !== 1000 && this.reconnectAttempts < this.config.reconnectAttempts) {
              this.scheduleReconnect(taskId);
            }
          },

          error: (_peer, event) => {
            timeoutResolved = true;
            globalThis.clearTimeout(timeoutId);
            this.connectionState = "error";
            this.stopHeartbeat();
            const error = new DoclingNetworkError(`WebSocket error: ${event.message}`);
            this.emit("error", error);
            reject(error);
          },
        };

        this.ws = new CrossWebSocket(url, {
          timeout: this.config.timeout,
          hooks,
        });

        this.ws.connect().catch((error) => {
          timeoutResolved = true;
          globalThis.clearTimeout(timeoutId);
          this.connectionState = "error";
          reject(error);
        });
      } catch (error) {
        this.connectionState = "error";
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.stopHeartbeat();
      this.clearReconnectTimer();
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.connectionState = "disconnected";
    this._currentTaskId = null;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get current task ID being monitored
   */
  getCurrentTaskId(): string | null {
    return this._currentTaskId;
  }

  /**
   * Monitor task with real-time progress updates
   */
  async monitorTask(
    taskId: string,
    onProgress?: (progress: {
      stage: string;
      percentage?: number;
      message?: string;
      taskId: string;
      position?: number;
      status: string;
      timestamp: number;
    }) => void
  ): Promise<TaskStatusResponse> {
    return new Promise((resolve, reject) => {
      const handleTaskUpdate = (message: WebSocketMessage) => {
        if (message.task && message.task.task_id === taskId) {
          const task = message.task;

          if (onProgress) {
            const progressData: {
              stage: string;
              percentage: number;
              message?: string;
              taskId: string;
              status: string;
              timestamp: number;
              position?: number;
            } = {
              stage: task.task_status,
              percentage: this.calculateProgress(task.task_status),
              message: `Task ${taskId}: ${task.task_status}`,
              taskId: task.task_id,
              status: task.task_status,
              timestamp: Date.now(),
            };

            if (task.task_position !== undefined) {
              progressData.position = task.task_position;
            }

            onProgress(progressData);
          }

          if (task.task_status === "success") {
            this.removeAllListeners("task_update");
            this.removeAllListeners("error");
            resolve(task);
          } else if (task.task_status === "failure") {
            this.removeAllListeners("task_update");
            this.removeAllListeners("error");
            reject(new Error(`Task ${taskId} failed: ${task.task_status}`));
          }
        }
      };

      const handleError = (error: Error) => {
        this.removeAllListeners("task_update");
        this.removeAllListeners("error");
        reject(error);
      };

      this.on("task_update", handleTaskUpdate);
      this.on("error", handleError);

      this.connectToTask(taskId).catch(reject);
    });
  }

  /**
   * Calculate progress percentage based on task status
   */
  private calculateProgress(status: TaskStatus): number {
    const progressMap: Record<TaskStatus, number> = {
      pending: 0,
      started: 25,
      success: 100,
      failure: 100,
    };

    return progressMap[status] || 0;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === "connected" && this.ws?.isConnected() === true;
  }

  /**
   * Handle incoming WebSocket messages
   */
  private static readonly STATUS_EVENTS: Record<
    string,
    "taskComplete" | "taskFailed" | "taskStarted"
  > = {
    success: "taskComplete",
    failure: "taskFailed",
    started: "taskStarted",
  };

  private readonly messageHandlers: Record<string, (message: WebSocketMessage) => void> = {
    connection: (message) => {
      this.emit("connection", message);
    },
    update: (message) => {
      if (!message.task) return;

      this.emit("taskUpdate", message.task);
      this.emit("task_update", message);
      this.emit("status", [message.task.task_status, message.task.task_id]);

      this.emit("progress", {
        stage: message.task.task_status,
        percentage: this.calculateProgress(message.task.task_status),
        message: `Task ${message.task.task_id}: ${message.task.task_status}`,
        taskId: message.task.task_id,
        position: message.task.task_position,
        status: message.task.task_status,
        timestamp: Date.now(),
      });

      const statusEvent = DoclingWebSocketClient.STATUS_EVENTS[message.task.task_status];
      if (statusEvent) {
        this.emit(statusEvent, message.task);
      }
    },
    error: (message) => {
      const error: ProcessingError = {
        message: message.error || "Unknown WebSocket error",
        code: "WEBSOCKET_ERROR",
      };
      this.emit("taskError", error);
    },
  };

  private handleMessage(message: WebSocketMessage): void {
    const handler = this.messageHandlers[message.message ?? ""];
    if (handler) {
      handler(message);
    } else {
      this.emit("unknownMessage", message);
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = globalThis.setInterval(() => {
      if (this.ws?.isConnected()) {
        try {
          // Send a ping via the WebSocket
          this.ws.sendText(JSON.stringify({ type: "ping" }));
        } catch {
          // Ignore ping errors
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      globalThis.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(taskId: string): void {
    this.clearReconnectTimer();

    this.reconnectAttempts++;
    const reconnectDelay = this.config.reconnectDelay * 2 ** (this.reconnectAttempts - 1);

    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay: reconnectDelay });

    this.reconnectAbortController = new AbortController();

    delay(reconnectDelay, undefined, this.reconnectAbortController.signal)
      .then(async () => {
        try {
          await this.connectToTask(taskId);
        } catch (error) {
          this.emit("reconnectFailed", {
            attempt: this.reconnectAttempts,
            error,
          });
        }
      })
      .catch(() => {
        // Aborted - do nothing
      });
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectAbortController) {
      this.reconnectAbortController.abort();
      this.reconnectAbortController = null;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<WebSocketConfig>): void {
    Object.assign(this.config, config);

    if (config.baseUrl) {
      this.config.baseUrl = this.config.baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

      if (this.config.baseUrl.endsWith("/")) {
        this.config.baseUrl = this.config.baseUrl.slice(0, -1);
      }
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): WebSocketConfig {
    return { ...this.config };
  }
}

/**
 * WebSocket async task events
 */
interface WebSocketAsyncTaskEvents {
  [key: string]: unknown;
  progress: TaskStatusResponse;
  complete: TaskStatusResponse;
  failed: TaskStatusResponse;
  error: ProcessingError | Error;
  disconnected: undefined;
}

/**
 * Enhanced async task with WebSocket monitoring
 */
export class WebSocketAsyncTask extends CrossEventEmitter<WebSocketAsyncTaskEvents> {
  private wsClient: DoclingWebSocketClient;
  private isMonitoring = false;

  constructor(
    public taskId: string,
    public status: string,
    public position?: number,
    public meta?: Record<string, unknown>,
    wsConfig?: WebSocketConfig
  ) {
    super();

    if (wsConfig) {
      this.wsClient = new DoclingWebSocketClient(wsConfig);
      this.setupWebSocketListeners();
    } else {
      throw new Error("WebSocket configuration is required for WebSocketAsyncTask");
    }
  }

  /**
   * Start monitoring task via WebSocket
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      return;
    }

    try {
      await this.wsClient.connectToTask(this.taskId);
      this.isMonitoring = true;
    } catch (error) {
      this.emit("error", error as Error);
      throw error;
    }
  }

  /**
   * Stop monitoring task
   */
  stopMonitoring(): void {
    if (this.isMonitoring) {
      this.wsClient.disconnect();
      this.isMonitoring = false;
    }
  }

  /**
   * Check if currently monitoring
   */
  isCurrentlyMonitoring(): boolean {
    return this.isMonitoring && this.wsClient.isConnected();
  }

  /**
   * Setup WebSocket event listeners
   */
  private setupWebSocketListeners(): void {
    this.wsClient.on("taskUpdate", (task: TaskStatusResponse) => {
      this.status = task.task_status;
      this.position = task.task_position;
      this.meta = task.task_meta;
      this.emit("progress", task);
    });

    this.wsClient.on("taskComplete", (task: TaskStatusResponse) => {
      this.status = task.task_status;
      this.emit("complete", task);
      this.stopMonitoring();
    });

    this.wsClient.on("taskFailed", (task: TaskStatusResponse) => {
      this.status = task.task_status;
      this.emit("failed", task);
      this.stopMonitoring();
    });

    this.wsClient.on("taskError", (error: ProcessingError) => {
      this.emit("error", error);
    });

    this.wsClient.on("error", (error: Error) => {
      this.emit("error", error);
    });

    this.wsClient.on("disconnected", () => {
      this.isMonitoring = false;
      this.emit("disconnected", undefined);
    });
  }

  /**
   * Get WebSocket client
   */
  getWebSocketClient(): DoclingWebSocketClient {
    return this.wsClient;
  }
}
