/** Progress tracking with WebSocket monitoring and a serial HTTP fallback. */
import type { HttpClient } from "../api/http";
import { DoclingWebSocketClient } from "../clients/websocket-client";
import { CrossEventEmitter } from "../platform/events";
import type { ProgressConfig, ProgressUpdate } from "../types/client";

export interface ProgressEvents {
  [key: string]: unknown;
  progress: ProgressUpdate;
  complete: unknown;
  error: Error;
}

function noop(): void {
  // Default optional callback.
}

export class ProgressTracker extends CrossEventEmitter<ProgressEvents> {
  private config: Required<ProgressConfig>;
  private wsClient: DoclingWebSocketClient | null = null;
  private pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private generation = 0;
  private isActive = false;
  private polling = false;
  private destroyed = false;
  private handlingError = false;

  constructor(
    private httpClient: HttpClient,
    baseUrl: string,
    config: ProgressConfig = {}
  ) {
    super();
    this.config = {
      method: config.method ?? "hybrid",
      websocketTimeout: config.websocketTimeout ?? 5000,
      httpPollInterval: config.httpPollInterval ?? 1000,
      onProgress: config.onProgress ?? noop,
      onComplete: config.onComplete ?? noop,
      onError: config.onError ?? noop,
      onWebhook: config.onWebhook ?? noop,
    };
    if (this.config.method === "hybrid" || this.config.method === "websocket") {
      this.wsClient = new DoclingWebSocketClient({
        baseUrl,
        timeout: this.config.websocketTimeout,
        reconnectAttempts: 0,
      });
    }
  }

  async startTracking(taskId: string): Promise<void> {
    if (this.destroyed) throw new Error("Progress tracker has been destroyed");
    // stopTracking invalidates callbacks synchronously, including pending HTTP requests.
    void this.stopTracking();
    const generation = this.generation;
    this.isActive = true;
    const current = () => this.isCurrent(generation) && this.isActive;
    if (!this.wsClient) {
      this.startHttpPolling(taskId, generation);
      return;
    }

    this.wsClient.on("progress", (progress) => {
      if (!current() || progress.taskId !== taskId) return;
      this.handleProgress({
        ...progress,
        stage: progress.status === "success" ? "completed" : progress.stage,
        source: "websocket",
      });
      if (!current()) return;
      if (progress.status === "success" || progress.status === "failure") {
        void this.handleCompletion(progress.status === "success", taskId, generation);
      } else this.armFallback(taskId, generation);
    });
    this.wsClient.on("taskError", (error) => {
      if (current()) void this.handleError(new Error(error.message), generation);
    });
    this.wsClient.on("error", (error) => {
      if (!current()) return;
      if (this.config.method === "hybrid") this.startHttpPolling(taskId, generation);
      else void this.handleError(error, generation);
    });
    this.wsClient.on("disconnected", () => {
      if (!current()) return;
      if (this.config.method === "hybrid") this.startHttpPolling(taskId, generation);
      else void this.handleError(new Error("WebSocket disconnected"), generation);
    });
    try {
      await this.wsClient.connectToTask(taskId);
      if (current() && !this.polling) this.armFallback(taskId, generation);
    } catch (error) {
      if (!current()) return;
      if (this.config.method === "hybrid") this.startHttpPolling(taskId, generation);
      else await this.handleError(error as Error, generation);
    }
  }

  async stopTracking(): Promise<void> {
    this.generation++;
    this.isActive = false;
    this.polling = false;
    this.handlingError = false;
    this.clearTimers();
    this.wsClient?.removeAllListeners();
    this.wsClient?.disconnect();
  }

  destroy(): void {
    this.destroyed = true;
    void this.stopTracking();
    this.removeAllListeners();
  }

  private isCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.generation;
  }

  private clearTimers(): void {
    if (this.pollTimer !== null) globalThis.clearTimeout(this.pollTimer);
    if (this.fallbackTimer !== null) globalThis.clearTimeout(this.fallbackTimer);
    this.pollTimer = null;
    this.fallbackTimer = null;
  }

  private armFallback(taskId: string, generation: number): void {
    if (this.config.method !== "hybrid" || this.polling) return;
    if (this.fallbackTimer !== null) globalThis.clearTimeout(this.fallbackTimer);
    this.fallbackTimer = globalThis.setTimeout(() => {
      if (this.isCurrent(generation) && this.isActive) {
        this.startHttpPolling(taskId, generation);
      }
    }, this.config.websocketTimeout);
  }

  private startHttpPolling(taskId: string, generation: number): void {
    if (!this.isCurrent(generation) || !this.isActive || this.polling) return;
    this.polling = true;
    this.clearTimers();
    this.wsClient?.removeAllListeners();
    this.wsClient?.disconnect();
    const poll = async () => {
      if (!this.isCurrent(generation) || !this.isActive) return;
      try {
        const { data } = await this.httpClient.get<{
          task_status: string;
          task_position?: number;
        }>(`/v1/status/${encodeURIComponent(taskId)}`);
        if (!this.isCurrent(generation) || !this.isActive) return;
        this.handleProgress({
          stage: data.task_status === "success" ? "completed" : data.task_status,
          ...(data.task_status === "success" && { percentage: 100 }),
          message: `Task ${data.task_status}`,
          taskId,
          position: data.task_position,
          status: data.task_status,
          timestamp: Date.now(),
          source: "http",
        });
        if (!this.isCurrent(generation) || !this.isActive) return;
        if (data.task_status === "success" || data.task_status === "failure") {
          await this.handleCompletion(data.task_status === "success", taskId, generation);
        } else {
          this.pollTimer = globalThis.setTimeout(poll, this.config.httpPollInterval);
        }
      } catch (error) {
        if (this.isCurrent(generation)) await this.handleError(error as Error, generation);
      }
    };
    this.pollTimer = globalThis.setTimeout(poll, this.config.httpPollInterval);
  }

  private handleProgress(progress: ProgressUpdate): void {
    try {
      this.config.onProgress(progress);
      this.emit("progress", progress);
    } catch (error) {
      console.error("Error in progress callback:", error);
    }
  }

  private async handleCompletion(
    success: boolean,
    taskId: string,
    generation: number
  ): Promise<void> {
    if (!this.isCurrent(generation) || !this.isActive) return;
    this.isActive = false;
    this.clearTimers();
    this.wsClient?.removeAllListeners();
    this.wsClient?.disconnect();
    if (!success) {
      await this.handleError(new Error(`Task ${taskId} failed`), generation);
      return;
    }
    try {
      const result = await this.httpClient.get(`/v1/result/${encodeURIComponent(taskId)}`);
      if (!this.isCurrent(generation)) return;
      await this.config.onComplete(result.data);
      if (this.isCurrent(generation)) this.emit("complete", result.data);
    } catch (error) {
      if (this.isCurrent(generation)) await this.handleError(error as Error, generation);
    } finally {
      if (this.isCurrent(generation)) await this.stopTracking();
    }
  }

  private async handleError(error: Error, generation: number): Promise<void> {
    if (!this.isCurrent(generation) || this.handlingError) return;
    this.handlingError = true;
    this.isActive = false;
    this.clearTimers();
    this.wsClient?.removeAllListeners();
    this.wsClient?.disconnect();
    try {
      await this.config.onError(error);
    } catch (callbackError) {
      console.error("Error in error callback:", callbackError);
    } finally {
      // Terminal settlement is independent of the optional observer's success.
      try {
        if (this.isCurrent(generation)) this.emit("error", error);
      } finally {
        if (this.isCurrent(generation)) await this.stopTracking();
      }
    }
  }
}
