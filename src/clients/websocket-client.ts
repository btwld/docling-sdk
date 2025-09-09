/**
 * WebSocket client for real-time Docling task monitoring
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";
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
 * WebSocket client for task monitoring
 */
export class DoclingWebSocketClient extends EventEmitter {
  private config: Required<WebSocketConfig>;
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

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

    return new Promise((resolve, reject) => {
      try {
        this.connectionState = "connecting";
        this.emit("connecting", taskId);

        this.ws = new WebSocket(url);

        const timeoutController = { cancelled: false };
        this.setupConnectionTimeout(timeoutController, reject);

        this.ws.on("open", () => {
          timeoutController.cancelled = true;
          this.connectionState = "connected";
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.emit("connected", taskId);
          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          try {
            const message: WebSocketMessage = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            this.emit("error", new Error(`Failed to parse WebSocket message: ${error}`));
          }
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
          timeoutController.cancelled = true;
          this.connectionState = "disconnected";
          this.stopHeartbeat();
          this.emit("disconnected", { code, reason: reason.toString() });

          if (code !== 1000 && this.reconnectAttempts < this.config.reconnectAttempts) {
            this.scheduleReconnect(taskId);
          }
        });

        this.ws.on("error", (error: Error) => {
          timeoutController.cancelled = true;
          this.connectionState = "error";
          this.stopHeartbeat();
          this.emit("error", new DoclingNetworkError(`WebSocket error: ${error.message}`));
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
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
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
    return (
      this.connectionState === "connected" &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: WebSocketMessage): void {
    switch (message.message) {
      case "connection":
        this.emit("connection", message);
        break;

      case "update":
        if (message.task) {
          this.emit("taskUpdate", message.task);
          this.emit("task_update", message);

          if (message.task.task_status === "success") {
            this.emit("taskComplete", message.task);
          } else if (message.task.task_status === "failure") {
            this.emit("taskFailed", message.task);
          } else if (message.task.task_status === "started") {
            this.emit("taskStarted", message.task);
          }
        }
        break;

      case "error": {
        const error: ProcessingError = {
          message: message.error || "Unknown WebSocket error",
          code: "WEBSOCKET_ERROR",
        };
        this.emit("taskError", error);
        break;
      }

      default:
        this.emit("unknownMessage", message);
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(taskId: string): void {
    this.clearReconnectTimer();

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * 2 ** (this.reconnectAttempts - 1);

    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = this.scheduleReconnectAttempt(taskId, delay) as unknown as NodeJS.Timeout;
  }

  /**
   * Schedule reconnection attempt using timers/promises
   */
  private async scheduleReconnectAttempt(taskId: string, delay: number): Promise<void> {
    const { setTimeout } = await import("node:timers/promises");
    await setTimeout(delay);
    try {
      await this.connectToTask(taskId);
    } catch (error) {
      this.emit("reconnectFailed", {
        attempt: this.reconnectAttempts,
        error,
      });
    }
  }

  /**
   * Setup connection timeout using timers/promises
   */
  private async setupConnectionTimeout(
    timeoutController: { cancelled: boolean },
    reject: (reason?: unknown) => void
  ): Promise<void> {
    const { setTimeout } = await import("node:timers/promises");
    await setTimeout(this.config.timeout);
    if (!timeoutController.cancelled && this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.terminate();
      reject(new DoclingTimeoutError(this.config.timeout, "WebSocket connection"));
    }
  }

  /**
   * Clear reconnection timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      this.reconnectTimer = null;
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
 * Enhanced async task with WebSocket monitoring
 */
export class WebSocketAsyncTask extends EventEmitter {
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
      this.emit("error", error);
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
      this.emit("disconnected");
    });
  }

  /**
   * Get WebSocket client
   */
  getWebSocketClient(): DoclingWebSocketClient {
    return this.wsClient;
  }
}
