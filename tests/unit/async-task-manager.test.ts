import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../src/api/http";
import { createAPIClient } from "../../src/docling";
import { AsyncTaskManager, type TaskStatus } from "../../src/services/async-task-manager";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function statusResponse(task_status: TaskStatus) {
  return { data: { task_status }, status: 200, statusText: "OK", headers: {} };
}

describe("AsyncTaskManager task lifecycle", () => {
  let manager: AsyncTaskManager;
  let http: { post: ReturnType<typeof vi.fn>; getJson: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    http = { post: vi.fn(), getJson: vi.fn() };
    manager = new AsyncTaskManager(http as unknown as HttpClient);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  function expectClean() {
    expect(manager.getActiveTaskCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    for (const event of ["success", "failure", "timeout", "error"] as const) {
      expect(manager.listenerCount(event)).toBe(0);
    }
  }

  it.each([
    ["A", "B"],
    ["B", "A"],
  ] as const)(
    "settles success in %s/%s order without consuming the other task's waiter",
    async (first, second) => {
      const polls = {
        A: deferred<ReturnType<typeof statusResponse>>(),
        B: deferred<ReturnType<typeof statusResponse>>(),
      };
      http.getJson.mockImplementation((endpoint: string) =>
        endpoint.includes("/A?") ? polls.A.promise : polls.B.promise
      );
      manager.startPollingExistingTask("A");
      manager.startPollingExistingTask("B");
      const completed: string[] = [];
      const waits = {
        A: manager.waitForCompletion("A").then((result) => {
          completed.push("A");
          return result;
        }),
        B: manager.waitForCompletion("B").then((result) => {
          completed.push("B");
          return result;
        }),
      };
      await vi.advanceTimersByTimeAsync(1000);
      polls[first].resolve(statusResponse("success"));
      await expect(waits[first]).resolves.toMatchObject({
        success: true,
        taskId: first,
        finalStatus: "success",
        duration: 1000,
      });
      expect(completed).toEqual([first]);
      expect(manager.getActiveTaskCount()).toBe(1);
      expect(manager.getTaskInfo(first)).toBeNull();

      polls[second].resolve(statusResponse("success"));
      await expect(waits[second]).resolves.toMatchObject({ success: true, taskId: second });
      expect(completed).toEqual([first, second]);
      expectClean();
    }
  );

  it("shares the result across multiple and late waiters without installing terminal listeners", async () => {
    http.getJson.mockResolvedValue(statusResponse("success"));
    manager.startPollingExistingTask("shared");
    const waits = [manager.waitForCompletion("shared"), manager.waitForCompletion("shared")];
    expect(manager.eventNames()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    const [first, second] = await Promise.all(waits);
    expect(first).toEqual(second);
    await expect(manager.waitForCompletion("shared")).resolves.toEqual(first);
    expectClean();
  });

  it("cleans up success even when nobody is waiting and supports a later API caller", async () => {
    http.post.mockResolvedValue({ data: { task_id: "submitted" } });
    http.getJson.mockResolvedValue(statusResponse("success"));
    await expect(manager.submitTask("/submit", { source: "fixture" })).resolves.toBe("submitted");
    expect(http.post).toHaveBeenCalledWith("/submit", JSON.stringify({ source: "fixture" }));
    await vi.advanceTimersByTimeAsync(1000);
    expectClean();
    // API callers may call startPollingExistingTask again before awaiting an existing task.
    manager.startPollingExistingTask("submitted");
    await expect(manager.waitForCompletion("submitted")).resolves.toMatchObject({ success: true });
    await vi.advanceTimersByTimeAsync(300000);
    expect(http.getJson).toHaveBeenCalledTimes(1);
    expectClean();
  });

  it.each(["failure", "revoked"] as const)(
    "cleans up an unawaited %s and retains the failure convention",
    async (status) => {
      http.getJson.mockResolvedValue(statusResponse(status));
      manager.startPollingExistingTask("failed");
      await vi.advanceTimersByTimeAsync(1000);
      expectClean();
      await expect(manager.waitForCompletion("failed")).resolves.toMatchObject({
        success: false,
        error: { message: `Task ${status}` },
        finalStatus: "failure",
        duration: 1000,
      });
    }
  );

  it("keeps interleaved failure, success, timeout, cancellation and polling errors independent", async () => {
    http.getJson.mockImplementation((endpoint: string) => {
      if (endpoint.includes("/failed?")) return Promise.resolve(statusResponse("failure"));
      if (endpoint.includes("/succeeded?")) return Promise.resolve(statusResponse("success"));
      if (endpoint.includes("/errored?")) return Promise.reject(new Error("poll unavailable"));
      return Promise.resolve(statusResponse("started"));
    });
    const ids = ["failed", "succeeded", "timed-out", "cancelled", "errored"];
    for (const id of ids) {
      manager.startPollingExistingTask(id, { timeout: 1500, pollingRetries: 1 });
    }
    const waits = ids.map((id) => manager.waitForCompletion(id));
    await vi.advanceTimersByTimeAsync(1000);
    await manager.cancelTask("cancelled");
    await vi.advanceTimersByTimeAsync(500);
    const results = await Promise.all(waits);
    expect(results).toMatchObject([
      {
        taskId: "failed",
        success: false,
        error: { message: "Task failure" },
        finalStatus: "failure",
      },
      { taskId: "succeeded", success: true, finalStatus: "success" },
      {
        taskId: "timed-out",
        success: false,
        error: { message: "Task timeout" },
        finalStatus: "failure",
      },
      {
        taskId: "cancelled",
        success: false,
        error: { message: "Task cancelled" },
        finalStatus: "failure",
      },
      {
        taskId: "errored",
        success: false,
        error: {
          message: expect.stringContaining("Polling failed after 1"),
          details: expect.any(Error),
        },
        finalStatus: "failure",
      },
    ]);
    for (const [index, id] of ids.entries()) {
      await expect(manager.waitForCompletion(id)).resolves.toEqual(results[index]);
    }
    expectClean();
    await vi.advanceTimersByTimeAsync(300000);
    expect(http.getJson).toHaveBeenCalledTimes(5);
  });

  it("times out at the poll limit and clears the overall timeout", async () => {
    http.getJson.mockResolvedValue(statusResponse("started"));
    manager.startPollingExistingTask("limited", { maxPolls: 1, pollInterval: 100 });
    const waiting = manager.waitForCompletion("limited");
    await vi.advanceTimersByTimeAsync(1100);
    await expect(waiting).resolves.toMatchObject({ error: { message: "Task timeout" } });
    expect(http.getJson).toHaveBeenCalledTimes(1);
    expectClean();
  });

  describe.each(["cancel", "destroy", "timeout"] as const)(
    "%s during an in-flight poll",
    (terminal) => {
      it.each(["started", "success", "failure", "reject"] as const)(
        "ignores a late %s response and creates no new timers",
        async (outcome) => {
          const pending = deferred<ReturnType<typeof statusResponse>>();
          http.getJson.mockReturnValue(pending.promise);
          manager.startPollingExistingTask("in-flight", { timeout: 1500 });
          const waits = [
            manager.waitForCompletion("in-flight"),
            manager.waitForCompletion("in-flight"),
          ];
          await vi.advanceTimersByTimeAsync(1000);
          expect(http.getJson).toHaveBeenCalledTimes(1);
          if (terminal === "cancel") await manager.cancelTask("in-flight");
          else if (terminal === "destroy") manager.destroy();
          else await vi.advanceTimersByTimeAsync(500);
          const expectedMessage = {
            cancel: "Task cancelled",
            destroy: "Task manager destroyed",
            timeout: "Task timeout",
          }[terminal];
          for (const waiting of waits) {
            await expect(waiting).resolves.toMatchObject({
              success: false,
              error: { message: expectedMessage },
              finalStatus: "failure",
            });
          }
          expectClean();
          const emitted = vi.spyOn(manager, "emit");
          if (outcome === "reject") pending.reject(new Error("late network failure"));
          else pending.resolve(statusResponse(outcome));
          await vi.advanceTimersByTimeAsync(300000);
          expect(emitted).not.toHaveBeenCalled();
          expect(http.getJson).toHaveBeenCalledTimes(1);
          await expect(manager.waitForCompletion("in-flight")).resolves.toMatchObject({
            error: { message: expectedMessage },
          });
          expectClean();
        }
      );
    }
  );

  it.each(["cancel", "destroy"] as const)(
    "handles %s from a status observer before scheduling the next poll",
    async (action) => {
      http.getJson.mockResolvedValue(statusResponse("started"));
      manager.on("status", ({ taskId, status }) => {
        if (status !== "started") return;
        if (action === "destroy") manager.destroy();
        else void manager.cancelTask(taskId);
      });
      manager.startPollingExistingTask("observer");
      const waiting = manager.waitForCompletion("observer");
      await vi.advanceTimersByTimeAsync(1000);
      await expect(waiting).resolves.toMatchObject({ success: false });
      expectClean();
    }
  );

  it.each(["cancel", "destroy"] as const)(
    "clears an already scheduled polling retry on %s",
    async (action) => {
      const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
      http.getJson.mockRejectedValue(new Error("temporary polling failure"));
      try {
        manager.startPollingExistingTask("retrying", { pollingRetries: 3 });
        const waiting = manager.waitForCompletion("retrying");
        await vi.advanceTimersByTimeAsync(1000);
        expect(http.getJson).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(2);
        if (action === "destroy") manager.destroy();
        else await manager.cancelTask("retrying");
        await expect(waiting).resolves.toMatchObject({ success: false });
        expectClean();
        await vi.advanceTimersByTimeAsync(300000);
        expect(http.getJson).toHaveBeenCalledTimes(1);
      } finally {
        logged.mockRestore();
      }
    }
  );

  it("prevents pending submissions and new tasks from registering after destruction", async () => {
    const submitted = deferred<{ data: { task_id: string } }>();
    http.post.mockReturnValue(submitted.promise);
    const submission = manager.submitTask("/submit", {});
    const rejected = expect(submission).rejects.toThrow("Task manager destroyed");
    manager.on("success", vi.fn());
    manager.destroy();
    manager.destroy();
    submitted.resolve({ data: { task_id: "too-late" } });
    await rejected;
    await expect(manager.submitTask("/submit", {})).rejects.toThrow("Task manager destroyed");
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(() => manager.startPollingExistingTask("too-late")).toThrow("Task manager destroyed");
    expect(manager.eventNames()).toEqual([]);
    expectClean();
  });

  it("resolves unknown task IDs immediately without listeners or polling", async () => {
    await expect(manager.waitForCompletion("unknown")).resolves.toEqual({
      success: false,
      error: { message: "Task not found" },
      taskId: "unknown",
      finalStatus: "failure",
      duration: 0,
    });
    expect(http.getJson).not.toHaveBeenCalled();
    expectClean();
  });

  it.each([true, false])(
    "preserves the first terminal result (success=%s) across repeated events",
    async (success) => {
      manager.startPollingExistingTask("repeat");
      const waiting = manager.waitForCompletion("repeat");
      await vi.advanceTimersByTimeAsync(50);
      if (success) manager.emit("success", { taskId: "repeat" });
      else manager.emit("failure", { taskId: "repeat", error: "first failure" });
      const first = await waiting;
      expect(first).toMatchObject({ success, duration: 50 });
      manager.emit("success", { taskId: "repeat" });
      manager.emit("failure", { taskId: "repeat", error: "second failure" });
      manager.emit("timeout", { taskId: "repeat" });
      manager.emit("error", { taskId: "repeat", error: new Error("second error") });
      await manager.cancelTask("repeat");
      await vi.advanceTimersByTimeAsync(1000);
      await expect(manager.waitForCompletion("repeat")).resolves.toEqual(first);
      expect(http.getJson).not.toHaveBeenCalled();
      expectClean();
    }
  );

  it("does not depend on observer listeners for completion", async () => {
    http.getJson.mockResolvedValue(statusResponse("success"));
    manager.startPollingExistingTask("independent");
    const waiting = manager.waitForCompletion("independent");
    manager.removeAllListeners();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(waiting).resolves.toMatchObject({ success: true });
    expectClean();
  });

  it("does not create duplicate polling timers for the same task", async () => {
    http.getJson.mockResolvedValue(statusResponse("success"));
    manager.startPollingExistingTask("duplicate");
    manager.startPollingExistingTask("duplicate");
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(http.getJson).toHaveBeenCalledTimes(1);
    expectClean();
  });

  it("bounds retained terminal results to the latest 1,000 completions", async () => {
    manager.startPollingExistingTask("oldest");
    const originalWaiter = manager.waitForCompletion("oldest");
    manager.emit("success", { taskId: "oldest" });
    for (let index = 0; index < 1000; index++) {
      const taskId = `completed-${index}`;
      manager.startPollingExistingTask(taskId);
      manager.emit("success", { taskId });
    }
    await expect(originalWaiter).resolves.toMatchObject({ success: true });
    await expect(manager.waitForCompletion("oldest")).resolves.toMatchObject({
      error: { message: "Task not found" },
    });
    await expect(manager.waitForCompletion("completed-0")).resolves.toMatchObject({
      success: true,
    });
    await expect(manager.waitForCompletion("completed-999")).resolves.toMatchObject({
      success: true,
    });
    expectClean();
  });

  it.each(["success", "failure"] as const)(
    "removes the public conversion progress listener after task %s",
    async (status) => {
      const client = createAPIClient("http://127.0.0.1:1", { retries: 0 });
      const clientManager = client.getTaskManager();
      const progress = vi.fn();
      vi.spyOn(client.getHttpClient(), "uploadFiles").mockResolvedValue({
        data: { task_id: "progress", task_status: "pending" },
        status: 200,
        statusText: "OK",
        headers: {},
      });
      vi.spyOn(client.getHttpClient(), "getJson").mockImplementation(async (endpoint) => ({
        data: endpoint.startsWith("/v1/result/")
          ? { document: { md_content: "fixture" } }
          : { task_id: "progress", task_status: status },
        status: 200,
        statusText: "OK",
        headers: {},
      }));
      try {
        const converting = client.convertWithProgress(
          new Uint8Array(10 * 1024 * 1024 + 1),
          "fixture.pdf",
          {},
          progress
        );
        // Attach failure handling before advancing the poll timer.
        const result =
          status === "success"
            ? expect(converting).resolves.toMatchObject({ document: { md_content: "fixture" } })
            : expect(converting).rejects.toThrow("Task failure");
        await vi.advanceTimersByTimeAsync(0);
        expect(clientManager.listenerCount("status")).toBe(1);
        await vi.advanceTimersByTimeAsync(1000);
        await result;
        expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "processing" }));
        expect(clientManager.listenerCount("status")).toBe(0);
        expect(clientManager.getActiveTaskCount()).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        client.destroy();
      }
    }
  );
});
