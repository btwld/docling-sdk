/**
 * Async Task Manager with cross-runtime EventEmitter
 * Handles async task submission, polling, and completion
 * Reusable across API, CLI, and other contexts
 */

import type { HttpClient } from "../api/http";
import { CrossEventEmitter } from "../platform/events";

/**
 * Task status from the API
 */
export type TaskStatus = "pending" | "started" | "success" | "failure" | "revoked";

/**
 * Task events that can be emitted
 */
export interface TaskEvents {
  [key: string]: unknown;
  status: { status: TaskStatus; taskId: string };
  progress: { progress: { stage: string; message?: string }; taskId: string };
  success: { taskId: string };
  failure: { error: string; taskId: string };
  timeout: { taskId: string };
  error: { error: Error; taskId: string };
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
 * Active task state
 */
interface ActiveTask {
  startTime: number;
  options: Required<TaskOptions>;
  completion: Promise<TaskResult>;
  resolveCompletion: (result: TaskResult) => void;
  pollTimer?: ReturnType<typeof globalThis.setTimeout>;
  timeoutTimer?: ReturnType<typeof globalThis.setTimeout>;
}

/**
 * Async Task Manager with EventEmitter
 * Handles async task submission, polling, and completion
 * Reusable across API, CLI, and other contexts
 */
export class AsyncTaskManager extends CrossEventEmitter<TaskEvents> {
  private activeTasks = new Map<string, ActiveTask>();
  // Keep the most recent 1,000 terminal tasks, in completion order, for late waiters.
  private completedTasks = new Map<string, Promise<TaskResult>>();
  private destroyed = false;
  private http: HttpClient;

  constructor(http: HttpClient) {
    super();
    this.http = http;
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
    try {
      if (this.destroyed) throw new Error("Task manager destroyed");

      const response = await this.http.post<{ task_id: string }>(
        endpoint,
        JSON.stringify(parameters)
      );

      const taskId = response.data.task_id;
      this.trackTask(taskId, options);
      return taskId;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.emit("error", { error: errorObj, taskId: "unknown" });
      throw errorObj;
    }
  }

  /**
   * Start polling for an existing task
   */
  startPollingExistingTask(taskId: string, options: TaskOptions = {}): void {
    this.trackTask(taskId, options);
  }

  /**
   * Wait for a tracked task, including one that has already completed.
   * Results are retained for the latest 1,000 completions. Unknown or evicted IDs
   * resolve immediately with a "Task not found" failure; they do not start polling.
   */
  async waitForCompletion<T = unknown>(taskId: string): Promise<TaskResult<T>> {
    const completion = this.activeTasks.get(taskId)?.completion ?? this.completedTasks.get(taskId);
    return completion
      ? (completion as Promise<TaskResult<T>>)
      : {
          success: false,
          error: { message: "Task not found" },
          taskId,
          finalStatus: "failure",
          duration: 0,
        };
  }

  /** Settle terminal state before notifying observers, independently of waiters. */
  override emit<K extends keyof TaskEvents>(type: K, event: TaskEvents[K]): this {
    if (type === "success") {
      this.completeTask((event as TaskEvents["success"]).taskId);
    } else if (type === "failure") {
      const failure = event as TaskEvents["failure"];
      this.completeTask(failure.taskId, { message: failure.error });
    } else if (type === "timeout") {
      this.completeTask((event as TaskEvents["timeout"]).taskId, { message: "Task timeout" });
    } else if (type === "error") {
      const failure = event as TaskEvents["error"];
      this.completeTask(failure.taskId, {
        message: failure.error.message,
        details: failure.error,
      });
    }
    return super.emit(type, event);
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
    this.emit("failure", { error: "Task cancelled", taskId });
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
   * Clean up all tasks (for shutdown)
   */
  destroy(): void {
    this.destroyed = true;
    for (const taskId of this.activeTasks.keys()) {
      this.completeTask(taskId, { message: "Task manager destroyed" });
    }
    this.removeAllListeners();
  }

  // Private methods

  private trackTask(taskId: string, options: TaskOptions): void {
    if (this.destroyed) throw new Error("Task manager destroyed");
    if (!taskId || typeof taskId !== "string")
      throw new Error("Invalid task response: missing task_id");
    if (this.activeTasks.has(taskId) || this.completedTasks.has(taskId)) return;

    let resolveCompletion!: ActiveTask["resolveCompletion"];
    const completion = new Promise<TaskResult>((resolve) => {
      resolveCompletion = resolve;
    });
    this.activeTasks.set(taskId, {
      startTime: Date.now(),
      options: this.normalizeOptions(options),
      completion,
      resolveCompletion,
    });
    this.startPolling(taskId);
    this.setTaskTimeout(taskId);
    this.emit("status", { status: "pending", taskId });
  }

  private completeTask(taskId: string, error?: TaskResult["error"]): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    const result: TaskResult = {
      success: !error,
      ...(error && { error }),
      taskId,
      finalStatus: error ? "failure" : "success",
      duration: Date.now() - task.startTime,
    };
    this.cleanup(taskId);
    this.completedTasks.set(taskId, task.completion);
    if (this.completedTasks.size > 1000) {
      const oldest = this.completedTasks.keys().next().value;
      if (oldest !== undefined) this.completedTasks.delete(oldest);
    }
    task.resolveCompletion(result);
  }

  /**
   * Normalize task options with defaults
   */
  private normalizeOptions(options: TaskOptions): Required<TaskOptions> {
    return {
      timeout: options.timeout ?? 300000,
      pollInterval: options.pollInterval ?? 2000,
      maxPolls: options.maxPolls ?? 150,
      waitSeconds: options.waitSeconds ?? 100,
      pollingRetries: options.pollingRetries ?? 5,
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
      if (this.activeTasks.get(taskId) !== task) return;

      try {
        pollCount++;

        const maxPolls = task.options.maxPolls;
        if (pollCount > maxPolls) {
          this.emit("timeout", { taskId });
          return;
        }

        const requestStart = Date.now();
        const waitSeconds = task.options.waitSeconds;

        const response = await this.http.getJson<{ task_status: TaskStatus }>(
          `/v1/status/poll/${taskId}?wait=${waitSeconds}`
        );

        // Cancellation, timeout, or destruction may have happened during the request.
        if (this.activeTasks.get(taskId) !== task) return;

        // Reset failure counter on successful request
        consecutiveFailures = 0;

        const status = response.data.task_status;
        this.emit("status", { status, taskId });
        if (this.activeTasks.get(taskId) !== task) return;

        if (status === "success") {
          this.emit("success", { taskId });
          return;
        }

        if (status === "failure" || status === "revoked") {
          this.emit("failure", { error: `Task ${status}`, taskId });
          return;
        }

        const requestDuration = Date.now() - requestStart;
        const delay =
          requestDuration < 5000
            ? waitSeconds > 0
              ? Math.min(task.options.pollInterval, waitSeconds * 1000)
              : task.options.pollInterval
            : 1000; // Minimal delay if server did proper long polling

        task.pollTimer = globalThis.setTimeout(poll, delay);
      } catch (error) {
        if (this.activeTasks.get(taskId) !== task) return;

        consecutiveFailures++;
        const maxRetries = task.options.pollingRetries;

        console.warn(
          `AsyncTaskManager polling failed for task ${taskId} (${consecutiveFailures}/${maxRetries}):`,
          error instanceof Error ? error.message : String(error)
        );

        if (consecutiveFailures >= maxRetries) {
          const errorObj = new Error(
            `Polling failed after ${maxRetries} consecutive attempts. Last error: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          this.emit("error", { error: errorObj, taskId });
          return;
        }

        const retryDelay = Math.min(2000 * 2 ** (consecutiveFailures - 1), 32000);
        console.log(`Retrying task ${taskId} in ${retryDelay}ms...`);

        task.pollTimer = globalThis.setTimeout(poll, retryDelay);
      }
    };

    task.pollTimer = globalThis.setTimeout(poll, 1000);
  }

  /**
   * Set task timeout
   */
  private setTaskTimeout(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.timeoutTimer = globalThis.setTimeout(() => {
      if (this.activeTasks.get(taskId) !== task) return;
      this.emit("timeout", { taskId });
    }, task.options.timeout);
  }

  /**
   * Clean up task resources
   */
  private cleanup(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    if (task.pollTimer !== undefined) {
      globalThis.clearTimeout(task.pollTimer);
    }

    if (task.timeoutTimer !== undefined) {
      globalThis.clearTimeout(task.timeoutTimer);
    }

    this.activeTasks.delete(taskId);
  }
}

/**
 * Typed EventEmitter interface for better TypeScript support
 * @deprecated Use CrossEventEmitter<TaskEvents> directly
 */
export interface TypedAsyncTaskManager {
  on<K extends keyof TaskEvents>(event: K, listener: (data: TaskEvents[K]) => void): this;
  emit<K extends keyof TaskEvents>(event: K, data: TaskEvents[K]): this;
  once<K extends keyof TaskEvents>(event: K, listener: (data: TaskEvents[K]) => void): this;
  off<K extends keyof TaskEvents>(event: K, listener: (data: TaskEvents[K]) => void): this;
}
