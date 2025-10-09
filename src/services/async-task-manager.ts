import { EventEmitter } from "node:events";
import type { HttpClient } from "../api/http";

/**
 * Task status from the API
 */
export type TaskStatus = "pending" | "started" | "success" | "failure" | "revoked";

/**
 * Task events that can be emitted
 */
export interface TaskEvents {
  status: (status: TaskStatus, taskId: string) => void;
  progress: (progress: { stage: string; message?: string }, taskId: string) => void;
  success: (taskId: string) => void;
  failure: (error: string, taskId: string) => void;
  timeout: (taskId: string) => void;
  error: (error: Error, taskId: string) => void;
}

/**
 * Task configuration options
 */
export interface TaskOptions {
  /** Maximum time to wait for task completion (ms) */
  timeout?: number;
  /** Polling interval (ms) */
  pollInterval?: number;
  /** Maximum number of polls before timeout */
  maxPolls?: number;
  /** Wait time for long polling (seconds) */
  waitSeconds?: number;
  /** Maximum retries for polling failures */
  pollingRetries?: number;
}

/**
 * Task result when completed
 */
export interface TaskResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    details?: unknown;
  };
  taskId: string;
  finalStatus: TaskStatus;
  duration: number;
}

/**
 * Async Task Manager with EventEmitter
 * Handles async task submission, polling, and completion
 * Reusable across API, CLI, and other contexts
 */
export class AsyncTaskManager extends EventEmitter implements TypedAsyncTaskManager {
  private activeTasks = new Map<
    string,
    {
      startTime: number;
      options: TaskOptions;
      pollTimer?: NodeJS.Timeout;
      timeoutTimer?: NodeJS.Timeout;
    }
  >();

  constructor(private http: HttpClient) {
    super();
  }

  /**
   * Submit a new async task
   * Returns task ID immediately, emits events for status updates
   */
  async submitTask(
    endpoint: string,
    parameters: Record<string, unknown>,
    options: TaskOptions = {}
  ): Promise<string> {
    const taskOptions: Required<TaskOptions> = {
      timeout: options.timeout || 300000,
      pollInterval: options.pollInterval || 2000,
      maxPolls: options.maxPolls || 150,
      waitSeconds: options.waitSeconds || 100,
      pollingRetries: options.pollingRetries || 5,
    };

    try {
      const response = await this.http.post<{ task_id: string }>(
        endpoint,
        JSON.stringify(parameters)
      );

      const taskId = response.data.task_id;

      this.activeTasks.set(taskId, {
        startTime: Date.now(),
        options: taskOptions,
      });

      this.startPolling(taskId);

      this.setTaskTimeout(taskId);

      this.emit("status", "pending", taskId);

      return taskId;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.emit("error", errorObj, "unknown");
      throw errorObj;
    }
  }

  startPollingExistingTask(taskId: string, options: TaskOptions = {}): void {
    const taskOptions: Required<TaskOptions> = {
      timeout: options.timeout || 300000,
      pollInterval: options.pollInterval || 2000,
      maxPolls: options.maxPolls || 150,
      waitSeconds: options.waitSeconds || 100,
      pollingRetries: options.pollingRetries || 5,
    };

    if (!this.activeTasks.has(taskId)) {
      this.activeTasks.set(taskId, {
        startTime: Date.now(),
        options: taskOptions,
      });

      this.startPolling(taskId);
      this.setTaskTimeout(taskId);
      this.emit("status", "pending", taskId);
    }
  }

  /**
   * Wait for task completion
   * Returns a Promise that resolves when task completes
   */
  async waitForCompletion<T = unknown>(taskId: string): Promise<TaskResult<T>> {
    return new Promise((resolve) => {
      const handleCompletion = (completedTaskId: string) => {
        if (completedTaskId !== taskId) return;

        const task = this.activeTasks.get(taskId);
        if (!task) {
          resolve({
            success: false,
            error: { message: "Task not found" },
            taskId,
            finalStatus: "failure",
            duration: 0,
          });
          return;
        }

        const duration = Date.now() - task.startTime;
        this.cleanup(taskId);

        resolve({
          success: true,
          taskId,
          finalStatus: "success",
          duration,
        });
      };

      const handleFailure = (error: string, failedTaskId: string) => {
        if (failedTaskId !== taskId) return;

        const task = this.activeTasks.get(taskId);
        const duration = task ? Date.now() - task.startTime : 0;
        this.cleanup(taskId);

        resolve({
          success: false,
          error: { message: error },
          taskId,
          finalStatus: "failure",
          duration,
        });
      };

      const handleTimeout = (timeoutTaskId: string) => {
        if (timeoutTaskId !== taskId) return;

        const task = this.activeTasks.get(taskId);
        const duration = task ? Date.now() - task.startTime : 0;
        this.cleanup(taskId);

        resolve({
          success: false,
          error: { message: "Task timeout" },
          taskId,
          finalStatus: "failure",
          duration,
        });
      };

      const handleError = (error: Error, errorTaskId: string) => {
        if (errorTaskId !== taskId) return;

        const task = this.activeTasks.get(taskId);
        const duration = task ? Date.now() - task.startTime : 0;
        this.cleanup(taskId);

        resolve({
          success: false,
          error: { message: error.message, details: error },
          taskId,
          finalStatus: "failure",
          duration,
        });
      };

      this.once("success", handleCompletion);
      this.once("failure", handleFailure);
      this.once("timeout", handleTimeout);
      this.once("error", handleError);
    });
  }

  /**
   * Get task result when completed
   */
  async getTaskResult<T = unknown>(taskId: string): Promise<T> {
    const response = await this.http.get<T>(`/v1/result/${taskId}`);
    return response.data;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<void> {
    this.cleanup(taskId);
    this.emit("failure", "Task cancelled", taskId);
  }

  /**
   * Get active task count
   */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Get task info
   */
  getTaskInfo(taskId: string) {
    const task = this.activeTasks.get(taskId);
    if (!task) return null;

    return {
      taskId,
      duration: Date.now() - task.startTime,
      options: task.options,
    };
  }

  /**
   * Start polling for task status
   */
  private startPolling(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    let pollCount = 0;
    let consecutiveFailures = 0;

    const poll = async () => {
      try {
        pollCount++;

        const maxPolls = task.options.maxPolls ?? 60;
        if (pollCount > maxPolls) {
          this.emit("timeout", taskId);
          return;
        }

        const requestStart = Date.now();
        const waitSeconds = task.options.waitSeconds ?? 100;

        const response = await this.http.getJson<{ task_status: TaskStatus }>(
          `/v1/status/poll/${taskId}?wait=${waitSeconds}`
        );

        // Reset failure counter on successful request
        consecutiveFailures = 0;

        const status = response.data.task_status;
        this.emit("status", status, taskId);

        if (status === "success") {
          this.emit("success", taskId);
          return;
        }

        if (status === "failure" || status === "revoked") {
          this.emit("failure", `Task ${status}`, taskId);
          return;
        }

        const requestDuration = Date.now() - requestStart;
        const delay =
          requestDuration < 5000
            ? Math.min(task.options.pollInterval ?? 2000, waitSeconds * 1000)
            : 1000; // Minimal delay if server did proper long polling

        task.pollTimer = setTimeout(poll, delay);
      } catch (error) {
        consecutiveFailures++;
        const maxRetries = task.options.pollingRetries ?? 5;

        console.warn(
          `⚠️  AsyncTaskManager polling failed for task ${taskId} (${consecutiveFailures}/${maxRetries}):`,
          error instanceof Error ? error.message : String(error)
        );

        if (consecutiveFailures >= maxRetries) {
          const errorObj = new Error(
            `Polling failed after ${maxRetries} consecutive attempts. Last error: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          this.emit("error", errorObj, taskId);
          return;
        }

        const retryDelay = Math.min(2000 * 2 ** (consecutiveFailures - 1), 32000);
        console.log(`🔄 AsyncTaskManager retrying task ${taskId} in ${retryDelay}ms...`);

        task.pollTimer = setTimeout(poll, retryDelay);
      }
    };

    task.pollTimer = setTimeout(poll, 1000);
  }

  /**
   * Set task timeout
   */
  private setTaskTimeout(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.timeoutTimer = setTimeout(() => {
      this.emit("timeout", taskId);
    }, task.options.timeout);
  }

  /**
   * Clean up task resources
   */
  private cleanup(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    if (task.pollTimer) {
      clearTimeout(task.pollTimer);
    }

    if (task.timeoutTimer) {
      clearTimeout(task.timeoutTimer);
    }

    this.activeTasks.delete(taskId);
  }

  /**
   * Clean up all tasks (for shutdown)
   */
  destroy(): void {
    for (const taskId of this.activeTasks.keys()) {
      this.cleanup(taskId);
    }
    this.removeAllListeners();
  }
}

/**
 * Typed EventEmitter interface for better TypeScript support
 */
export interface TypedAsyncTaskManager {
  on<K extends keyof TaskEvents>(event: K, listener: TaskEvents[K]): this;
  emit<K extends keyof TaskEvents>(event: K, ...args: Parameters<TaskEvents[K]>): boolean;
  once<K extends keyof TaskEvents>(event: K, listener: TaskEvents[K]): this;
  off<K extends keyof TaskEvents>(event: K, listener: TaskEvents[K]): this;
}
