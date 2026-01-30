/**
 * Progress tracker that combines WebSocket and HTTP polling
 * Uses cross-runtime event emitter and timers
 */

import { CrossEventEmitter } from "../platform/events";
import { delay } from "../platform/timers";
import type { HttpClient } from "../api/http";
import { DoclingWebSocketClient } from "../clients/websocket-client";
import type { ProgressConfig, ProgressUpdate } from "../types/client";

/**
 * Progress events that can be emitted
 */
export interface ProgressEvents {
  [key: string]: unknown;
  progress: ProgressUpdate;
  complete: unknown;
  error: Error;
}

/**
 * No-operation function for default callbacks
 */
function noop(): void {
  // Intentionally empty - no-op function
}

/**
 * Progress tracker that combines WebSocket and HTTP polling
 * Always tries WebSocket first, falls back to HTTP polling if needed
 */
export class ProgressTracker extends CrossEventEmitter<ProgressEvents> {
  private config: Required<ProgressConfig>;
  private wsClient: DoclingWebSocketClient | null = null;
  private httpClient: HttpClient;
  private pollTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private isActive = false;
  private currentTaskId: string | null = null;
  private lastProgressTime = 0;

  constructor(httpClient: HttpClient, baseUrl: string, config: ProgressConfig = {}) {
    super();

    this.httpClient = httpClient;

    this.config = {
      method: config.method || "hybrid",
      websocketTimeout: config.websocketTimeout || 5000,
      httpPollInterval: config.httpPollInterval || 1000,
      onProgress: config.onProgress || noop,
      onComplete: config.onComplete || noop,
      onError: config.onError || noop,
      onWebhook: config.onWebhook || noop,
    };

    if (this.config.method === "hybrid" || this.config.method === "websocket") {
      this.wsClient = new DoclingWebSocketClient({
        baseUrl,
        timeout: this.config.websocketTimeout,
        reconnectAttempts: 3,
        reconnectDelay: 2000,
        heartbeatInterval: 30000,
      });
    }
  }

  /** Start tracking progress for a task */
  async startTracking(taskId: string): Promise<void> {
    if (this.isActive) {
      await this.stopTracking();
    }

    this.isActive = true;
    this.currentTaskId = taskId;
    this.lastProgressTime = Date.now();

    try {
      if (
        this.wsClient &&
        (this.config.method === "hybrid" || this.config.method === "websocket")
      ) {
        await this.startWebSocketTracking(taskId);
      } else {
        this.startHttpPolling(taskId);
      }
    } catch (error) {
      if (this.config.method === "hybrid") {
        console.warn("WebSocket failed, falling back to HTTP polling:", error);
        this.startHttpPolling(taskId);
      } else {
        await this.handleError(error as Error);
      }
    }
  }

  /** Stop tracking progress */
  async stopTracking(): Promise<void> {
    this.isActive = false;

    if (this.pollTimer) {
      globalThis.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.wsClient) {
      try {
        this.wsClient.removeAllListeners();
      } catch {
        // Ignore errors
        /* no-op */
      }
    }

    this.currentTaskId = null;
  }

  /** Start WebSocket tracking with timeout fallback */
  private async startWebSocketTracking(taskId: string): Promise<void> {
    if (!this.wsClient) return;

    this.wsClient.on("progress", (progress) => {
      this.handleProgress({
        ...progress,
        taskId,
        timestamp: Date.now(),
        source: "websocket",
      });
    });

    this.wsClient.on("status", (statusData: [string, string]) => {
      const [status, receivedTaskId] = statusData;
      if (receivedTaskId === taskId) {
        this.handleProgress({
          stage: status === "success" ? "completed" : status,
          ...(status === "success" && { percentage: 100 }),
          message: `Task ${status}`,
          taskId: taskId,
          status,
          timestamp: Date.now(),
          source: "websocket",
        });

        if (status === "success" || status === "failure") {
          this.handleCompletion(status === "success");
        }
      }
    });

    this.wsClient.on("error", (error) => {
      if (this.config.method === "hybrid" && this.isActive) {
        console.warn("WebSocket error, falling back to HTTP polling:", error);
        this.startHttpPolling(taskId);
      } else {
        this.handleError(error);
      }
    });

    await this.wsClient.connectToTask(taskId);

    if (this.config.method === "hybrid") {
      this.setupWebSocketTimeout(taskId);
    }
  }

  /** Start HTTP polling */
  private startHttpPolling(taskId: string): void {
    if (this.pollTimer) {
      globalThis.clearInterval(this.pollTimer);
    }

    this.pollTimer = globalThis.setInterval(async () => {
      if (!this.isActive || this.currentTaskId !== taskId) {
        return;
      }

      try {
        const status = await this.httpClient.get<{
          task_status: string;
          task_position?: number;
        }>(`/v1/status/${taskId}`);
        const taskData = status.data;

        this.handleProgress({
          stage: taskData.task_status === "success" ? "completed" : taskData.task_status,
          ...(taskData.task_status === "success" && { percentage: 100 }),
          message: `Task ${taskData.task_status}`,
          taskId: taskId,
          ...(taskData.task_position !== undefined && {
            position: taskData.task_position,
          }),
          status: taskData.task_status,
          timestamp: Date.now(),
          source: "http",
        });

        if (taskData.task_status === "success" || taskData.task_status === "failure") {
          this.handleCompletion(taskData.task_status === "success");
        }
      } catch (error) {
        await this.handleError(error as Error);
      }
    }, this.config.httpPollInterval);
  }

  /** Setup WebSocket timeout using cross-runtime delay */
  private async setupWebSocketTimeout(taskId: string): Promise<void> {
    await delay(this.config.websocketTimeout);

    if (this.isActive && Date.now() - this.lastProgressTime > this.config.websocketTimeout) {
      console.warn("WebSocket timeout, falling back to HTTP polling");
      this.startHttpPolling(taskId);
    }
  }

  private async handleProgress(progress: ProgressUpdate): Promise<void> {
    try {
      this.config.onProgress(progress);
      this.emit("progress", progress);
      this.lastProgressTime = Date.now();
    } catch (error) {
      console.error("Error in progress callback:", error);
    }
  }

  private async handleCompletion(success: boolean): Promise<void> {
    try {
      if (success) {
        const result = this.currentTaskId
          ? await this.httpClient.get(`/v1/result/${this.currentTaskId}`)
          : null;

        await this.config.onComplete(result?.data || { success: true });
        this.emit("complete", result?.data || { success: true });
      }
    } catch (error) {
      console.error("Error in completion callback:", error);
    } finally {
      await this.stopTracking();
    }
  }

  private async handleError(error: Error): Promise<void> {
    try {
      await this.config.onError(error);
      this.emit("error", error);
    } catch (callbackError) {
      console.error("Error in error callback:", callbackError);
    } finally {
      await this.stopTracking();
    }
  }
}
