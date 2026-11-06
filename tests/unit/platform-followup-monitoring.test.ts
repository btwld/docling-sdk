import { once } from "node:events";
import type { Socket } from "node:net";
import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { WebSocketAsyncTask } from "../../src/clients/websocket-client";
import type { TaskStatusResponse } from "../../src/types/api";

type Handshake = {
  finish: (allow: boolean, code?: number, reason?: string) => void;
};
const tasks: WebSocketAsyncTask[] = [];
const cleanup: Array<() => Promise<void>> = [];

async function fixture() {
  const handshakes: Handshake[] = [];
  const waiting: Array<() => void> = [];
  const transports = new Set<Socket>();
  const peers: WebSocket[] = [];
  let attempts = 0;
  let acceptNewConnections = false;
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: (info, finish) => {
      attempts++;
      transports.add(info.req.socket);
      if (acceptNewConnections) {
        finish(true);
        return;
      }
      handshakes.push({ finish });
      waiting.shift()?.();
    },
  });
  server.on("connection", (peer) => peers.push(peer));
  cleanup.push(async () => {
    for (const peer of server.clients) peer.terminate();
    for (const transport of transports) transport.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected loopback port");
  const task = new WebSocketAsyncTask("task", "pending", undefined, undefined, {
    baseUrl: `ws://127.0.0.1:${address.port}`,
    reconnectAttempts: 0,
    heartbeatInterval: 0,
    timeout: 1000,
  });
  tasks.push(task);
  return {
    task,
    peer(index = -1) {
      const peer = peers.at(index);
      if (!peer) throw new Error("Expected connected peer");
      return peer;
    },
    attempts: () => attempts,
    acceptNewConnections: () => {
      acceptNewConnections = true;
    },
    async handshake() {
      if (!handshakes.length) await new Promise<void>((resolve) => waiting.push(resolve));
      const handshake = handshakes.shift();
      if (!handshake) throw new Error("Expected pending handshake");
      return handshake;
    },
  };
}

function observe(promise: Promise<void>) {
  const result: { status: "pending" | "fulfilled" | "rejected"; error?: unknown } = {
    status: "pending",
  };
  const settled = promise.then(
    () => {
      result.status = "fulfilled";
    },
    (error: unknown) => {
      result.status = "rejected";
      result.error = error;
    }
  );
  return { result, settled };
}

afterEach(async () => {
  for (const task of tasks.splice(0)) task.stopMonitoring();
  for (const close of cleanup.splice(0)) await close();
});

describe("WebSocketAsyncTask public startup lifecycle", () => {
  it("honors stop from a disconnected observer during retry cleanup", async () => {
    const f = await fixture();
    const first = f.task.startMonitoring();
    (await f.handshake()).finish(true);
    await first;
    const disconnected = new Promise<void>((resolve) => f.task.once("disconnected", resolve));
    f.peer().close(1000, "Remote close");
    await disconnected;
    f.acceptNewConnections();
    f.task.once("disconnected", () => f.task.stopMonitoring());
    await f.task.startMonitoring();
    expect(f.attempts()).toBe(1);
    expect(f.task.isCurrentlyMonitoring()).toBe(false);
    expect(f.task.getWebSocketClient().isConnected()).toBe(false);
    expect(f.task.getWebSocketClient().getCurrentTaskId()).toBeNull();
  });

  it.each([true, false])(
    "keeps concurrent startup callers pending and shares handshake success=%s",
    async (allow) => {
      const { task, handshake, attempts } = await fixture();
      const errors = vi.fn();
      task.on("error", errors);
      const first = observe(task.startMonitoring());
      const pending = await handshake();
      const second = observe(task.startMonitoring());
      await setImmediate();
      expect(first.result.status).toBe("pending");
      expect(second.result.status).toBe("pending");
      expect(task.isCurrentlyMonitoring()).toBe(false);
      expect(attempts()).toBe(1);

      pending.finish(allow, 503, "Startup refused");
      await Promise.all([first.settled, second.settled]);
      expect(first.result.status).toBe(allow ? "fulfilled" : "rejected");
      expect(second.result).toEqual(first.result);
      expect(second.result.error).toBe(first.result.error);
      expect(errors).toHaveBeenCalledTimes(allow ? 0 : 1);
      expect(task.isCurrentlyMonitoring()).toBe(allow);
    }
  );

  it.each(["normal-close", "failed-startup"])(
    "reports active monitoring after retry following %s",
    async (previous) => {
      const { task, handshake, peer, attempts } = await fixture();
      const first = observe(task.startMonitoring());
      (await handshake()).finish(previous === "normal-close", 503, "Startup refused");
      await first.settled;
      if (previous === "normal-close") {
        expect(task.isCurrentlyMonitoring()).toBe(true);
        const disconnected = new Promise<void>((resolve) => task.once("disconnected", resolve));
        peer(0).close(1000, "Server finished connection");
        await disconnected;
      } else {
        expect(first.result.status).toBe("rejected");
      }
      expect(task.isCurrentlyMonitoring()).toBe(false);

      const retry = observe(task.startMonitoring());
      const pending = await handshake();
      await setImmediate();
      expect(retry.result.status).toBe("pending");
      pending.finish(true);
      await retry.settled;
      expect(retry.result.status).toBe("fulfilled");
      expect(task.getWebSocketClient().isConnected()).toBe(true);
      expect(task.isCurrentlyMonitoring()).toBe(true);
      await task.startMonitoring();
      expect(attempts()).toBe(2);

      const complete = new Promise<TaskStatusResponse>((resolve) => task.once("complete", resolve));
      peer().send(
        JSON.stringify({ message: "update", task: { task_id: "task", task_status: "success" } })
      );
      expect((await complete).task_status).toBe("success");
      expect(task.isCurrentlyMonitoring()).toBe(false);
    }
  );

  it("settles concurrent callers on stop during a held handshake and permits a new startup", async () => {
    const { task, handshake } = await fixture();
    const errors = vi.fn();
    task.on("error", errors);
    const first = observe(task.startMonitoring());
    await handshake();
    const second = observe(task.startMonitoring());
    task.stopMonitoring();
    // Start the replacement before the canceled startup's continuations run.
    const replacement = observe(task.startMonitoring());
    const pending = await handshake();
    await Promise.all([first.settled, second.settled]);
    expect(first.result.status).toBe("fulfilled");
    expect(second.result.status).toBe("fulfilled");
    expect(replacement.result.status).toBe("pending");
    expect(task.isCurrentlyMonitoring()).toBe(false);
    const joined = observe(task.startMonitoring());
    await setImmediate();
    expect(joined.result.status).toBe("pending");
    pending.finish(true);
    await Promise.all([replacement.settled, joined.settled]);
    expect(task.isCurrentlyMonitoring()).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it("honors an immediate stop before connection setup begins", async () => {
    const { task, attempts } = await fixture();
    const connecting = vi.fn();
    task.getWebSocketClient().on("connecting", connecting);
    const first = task.startMonitoring();
    const second = task.startMonitoring();
    task.stopMonitoring();
    await Promise.all([first, second]);
    expect(connecting).not.toHaveBeenCalled();
    expect(attempts()).toBe(0);
    expect(task.isCurrentlyMonitoring()).toBe(false);
  });

  it.each(["success", "failure"] as const)(
    "settles concurrent callers when terminal %s arrives during a held handshake",
    async (status) => {
      const { task, handshake } = await fixture();
      const errors = vi.fn();
      task.on("error", errors);
      const first = task.startMonitoring();
      await handshake();
      const second = task.startMonitoring();
      task.getWebSocketClient().emit(status === "success" ? "taskComplete" : "taskFailed", {
        task_id: "task",
        task_status: status,
      });
      await Promise.all([first, second]);
      expect(task.status).toBe(status);
      expect(task.isCurrentlyMonitoring()).toBe(false);
      expect(task.getWebSocketClient().getConnectionState()).toBe("disconnected");
      expect(errors).not.toHaveBeenCalled();
    }
  );

  it.each(["stop", "success", "failure"] as const)(
    "does not revive monitoring when %s occurs before startup continuations",
    async (outcome) => {
      const { task, handshake } = await fixture();
      const sdk = task.getWebSocketClient();
      const complete = vi.fn();
      const failed = vi.fn();
      task.on("complete", complete).on("failed", failed);
      // The public connected observer runs after connection resolution but before
      // the wrapper's await resumes. Inject the terminal task event at this boundary.
      sdk.once("connected", () => {
        if (outcome === "stop") task.stopMonitoring();
        else {
          sdk.emit(outcome === "success" ? "taskComplete" : "taskFailed", {
            task_id: "task",
            task_status: outcome,
          });
        }
      });
      const first = observe(task.startMonitoring());
      const pending = await handshake();
      const second = observe(task.startMonitoring());
      pending.finish(true);
      await Promise.all([first.settled, second.settled]);
      expect(first.result.status).toBe("fulfilled");
      expect(second.result.status).toBe("fulfilled");
      expect(task.isCurrentlyMonitoring()).toBe(false);
      expect(sdk.isConnected()).toBe(false);
      expect(sdk.getConnectionState()).toBe("disconnected");
      expect(complete).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
      expect(failed).toHaveBeenCalledTimes(outcome === "failure" ? 1 : 0);
      if (outcome !== "stop") expect(task.status).toBe(outcome);
    }
  );
});
