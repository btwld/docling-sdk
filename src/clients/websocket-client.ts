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
  private generation = 0;
  private connectionPromise: Promise<void> | null = null;
  private cancelConnection: (() => void) | null = null;

  constructor(config: WebSocketConfig) {
    super();

    this.config = {
      baseUrl: config.baseUrl,
      timeout: config.timeout ?? 30000,
      reconnectAttempts: config.reconnectAttempts ?? 3,
      reconnectDelay: config.reconnectDelay ?? 5000,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
    };

    this.config.baseUrl = this.config.baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

    if (this.config.baseUrl.endsWith("/")) {
      this.config.baseUrl = this.config.baseUrl.slice(0, -1);
    }
  }

  /**
   * Connect to WebSocket for task monitoring
   */
  connectToTask(taskId: string): Promise<void> {
    if (this._currentTaskId === taskId) {
      if (this.isConnected()) return Promise.resolve();
      if (this.connectionPromise) return this.connectionPromise;
    }
    const generation = this.generation;
    this.disconnect();
    // A disconnect observer may stop or replace this request synchronously.
    if (this.generation !== generation + 1)
      return Promise.reject(new DoclingNetworkError("WebSocket connection canceled"));
    this.reconnectAttempts = 0;
    return this.openTask(taskId);
  }

  private openTask(taskId: string): Promise<void> {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this._currentTaskId = taskId;
    this.connectionState = "connecting";
    this.emit("connecting", taskId);
    if (!current()) return Promise.reject(new DoclingNetworkError("WebSocket connection canceled"));
    const promise = new Promise<void>((resolve, reject) => {
      this.cancelConnection = () =>
        reject(new DoclingNetworkError("WebSocket connection canceled"));
      const hooks: WebSocketHooks = {
        open: () => {
          if (!current()) return;
          this.connectionState = "connected";
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
          this.emit("connected", taskId);
        },
        message: (_peer, message) => {
          if (!current()) return;
          try {
            this.handleMessage(message.json<WebSocketMessage>());
          } catch (error) {
            this.emit("error", new Error(`Failed to parse WebSocket message: ${error}`));
          }
        },
        close: (_peer, event) => {
          if (!current()) return;
          this.connectionState = "disconnected";
          this.stopHeartbeat();
          reject(new DoclingNetworkError(`WebSocket closed: ${event.code} ${event.reason}`));
          try {
            this.emit("disconnected", { code: event.code, reason: event.reason });
          } finally {
            if (
              current() &&
              event.code !== 1000 &&
              this.reconnectAttempts < this.config.reconnectAttempts
            ) {
              this.scheduleReconnect(taskId);
            }
          }
        },
        error: (_peer, event) => {
          if (!current()) return;
          this.connectionState = "error";
          this.stopHeartbeat();
          const error = new DoclingNetworkError(`WebSocket error: ${event.message}`);
          reject(error);
          this.emit("error", error);
        },
      };
      this.ws = new CrossWebSocket(
        `${this.config.baseUrl}/v1/status/ws/${encodeURIComponent(taskId)}`,
        { timeout: this.config.timeout, hooks }
      );
      this.ws.connect().catch((error) => {
        if (!current()) return;
        if (this.connectionState === "connecting") this.connectionState = "error";
        reject(
          error instanceof Error && error.message.includes("timeout")
            ? new DoclingTimeoutError(this.config.timeout, "WebSocket connection")
            : error
        );
      });
    });
    this.connectionPromise = promise;
    const clear = () => {
      if (current()) {
        this.connectionPromise = null;
        this.cancelConnection = null;
      }
    };
    void promise.then(clear, clear);
    return promise;
  }

  disconnect(): void {
    const wasActive = this.connectionState !== "disconnected" || this._currentTaskId !== null;
    this.generation++;
    this.cancelConnection?.();
    this.cancelConnection = null;
    this.connectionPromise = null;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    const ws = this.ws;
    this.ws = null;
    this.connectionState = "disconnected";
    this._currentTaskId = null;
    ws?.close(1000, "Client disconnect");
    if (wasActive) this.emit("disconnected", { code: 1000, reason: "Client disconnect" });
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
    const connection = this.connectToTask(taskId);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.off("task_update", handleTaskUpdate);
        this.off("error", handleError);
        this.off("taskError", handleTaskError);
        this.off("disconnected", handleDisconnect);
      };
      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const handleTaskError = (error: ProcessingError) => handleError(new Error(error.message));
      const handleDisconnect = (event: { code: number }) => {
        if (event.code === 1000 || this.reconnectAttempts >= this.config.reconnectAttempts)
          handleError(new Error(`Task ${taskId} monitoring disconnected`));
      };
      const handleTaskUpdate = (message: WebSocketMessage) => {
        const task = message.task;
        if (!task || task.task_id !== taskId) return;
        try {
          onProgress?.({
            stage: task.task_status,
            percentage: this.calculateProgress(task.task_status),
            message: `Task ${taskId}: ${task.task_status}`,
            taskId,
            status: task.task_status,
            timestamp: Date.now(),
            position: task.task_position,
          });
          if (task.task_status === "success") {
            cleanup();
            resolve(task);
          } else if (task.task_status === "failure") {
            handleError(new Error(`Task ${taskId} failed: ${task.task_status}`));
          }
        } catch (error) {
          handleError(error as Error);
        }
      };
      this.on("task_update", handleTaskUpdate);
      this.on("error", handleError);
      this.on("taskError", handleTaskError);
      this.on("disconnected", handleDisconnect);
      connection.catch(handleError);
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

    if (this.config.heartbeatInterval <= 0) return;
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

    const attempt = ++this.reconnectAttempts;
    const reconnectDelay = this.config.reconnectDelay * 2 ** (attempt - 1);

    const generation = this.generation;
    const controller = new AbortController();
    this.reconnectAbortController = controller;
    this.emit("reconnecting", { attempt, delay: reconnectDelay });

    delay(reconnectDelay, undefined, controller.signal)
      .then(async () => {
        if (generation !== this.generation) return;
        const connection = this.openTask(taskId);
        const connectionGeneration = this.generation;
        try {
          await connection;
        } catch (error) {
          if (connectionGeneration === this.generation) {
            this.emit("reconnectFailed", { attempt, error });
          }
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
  private monitoringGeneration = 0;
  private monitoringStartup: Promise<void> | null = null;
  private errorReported = false;

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
   * Start monitoring task via WebSocket. Concurrent callers share startup's
   * outcome. An explicit stop or terminal task event cancels startup without
   * rejecting its callers; connection failures reject and emit an error once.
   */
  startMonitoring(): Promise<void> {
    if (this.monitoringStartup) return this.monitoringStartup;
    if (this.isCurrentlyMonitoring()) return Promise.resolve();

    this.errorReported = false;
    const generation = ++this.monitoringGeneration;
    this.isMonitoring = true;
    // Store startup before connecting can synchronously notify observers.
    const startup = Promise.resolve().then(async () => {
      if (generation !== this.monitoringGeneration) return;
      try {
        await this.wsClient.connectToTask(this.taskId);
        if (generation === this.monitoringGeneration)
          this.isMonitoring = this.wsClient.isConnected();
      } catch (error) {
        if (generation !== this.monitoringGeneration) return;
        this.isMonitoring = false;
        if (!this.errorReported) this.emit("error", error as Error);
        throw error;
      }
    });
    this.monitoringStartup = startup;
    const clear = () => {
      if (this.monitoringStartup === startup) this.monitoringStartup = null;
    };
    void startup.then(clear, clear);
    return startup;
  }

  /**
   * Stop monitoring task
   */
  stopMonitoring(): void {
    this.monitoringGeneration++;
    this.monitoringStartup = null;
    this.isMonitoring = false;
    this.wsClient.disconnect();
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
      if (task.task_id !== this.taskId) return;
      this.status = task.task_status;
      this.position = task.task_position;
      this.meta = task.task_meta;
      this.emit("progress", task);
    });

    this.wsClient.on("taskComplete", (task: TaskStatusResponse) => {
      if (task.task_id !== this.taskId) return;
      this.status = task.task_status;
      this.emit("complete", task);
      this.stopMonitoring();
    });

    this.wsClient.on("taskFailed", (task: TaskStatusResponse) => {
      if (task.task_id !== this.taskId) return;
      this.status = task.task_status;
      this.emit("failed", task);
      this.stopMonitoring();
    });

    this.wsClient.on("taskError", (error: ProcessingError) => {
      this.emit("error", error);
    });

    this.wsClient.on("error", (error: Error) => {
      this.errorReported = true;
      this.emit("error", error);
    });

    this.wsClient.on("disconnected", (event) => {
      if (event.code === 1000) this.isMonitoring = false;
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
