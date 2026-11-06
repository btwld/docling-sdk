import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { DoclingAPIClient } from "../../src/clients/api-client";
import { loopback } from "./api-hardening-fixture";

const document = {
  document: { filename: "input.pdf", md_content: "# WS" },
  status: "success",
  processing_time: 1,
};
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup())
  );
});
async function fixture(status: "success" | "failure" | "pending" = "success", presigned = false) {
  let nextTask = 0;
  const http = await loopback((request) =>
    request.url.includes("/result/")
      ? { body: presigned ? { url: "https://example.test/result" } : document }
      : { body: { task_id: `task-${++nextTask}` } }
  );
  const server = new WebSocketServer({ server: http.server });
  const connections: string[] = [];
  server.on("connection", (socket, request) => {
    const taskId = request.url!.split("/").pop()!;
    connections.push(taskId);
    socket.send(
      JSON.stringify({ message: "update", task: { task_id: taskId, task_status: "started" } })
    );
    if (status !== "pending")
      socket.send(
        JSON.stringify({ message: "update", task: { task_id: taskId, task_status: status } })
      );
  });
  const client = new DoclingAPIClient({
    type: "api",
    baseUrl: http.baseUrl,
    retries: 0,
    timeout: 500,
  });
  cleanups.push(
    http.close,
    () =>
      new Promise<void>((resolve) => {
        for (const socket of server.clients) socket.terminate();
        server.close(() => resolve());
      }),
    () => client.destroy()
  );
  return { ...http, client, connections, server };
}

describe("API WebSocket convenience methods", () => {
  it.each(["source", "file"] as const)(
    "monitors immediate %s task events and closes the socket",
    async (input) => {
      const { client, requests } = await fixture();
      const progress = vi.fn();
      expect(client.getWebSocketState()).toBe("disconnected");
      const result =
        input === "source"
          ? await client.convertWithWebSocket(
              { sources: [{ kind: "file", filename: "input.pdf", base64_string: "YQ==" }] },
              progress
            )
          : await client.convertFileWithWebSocket(
              Buffer.from("input"),
              "original.pdf",
              {},
              progress
            );
      expect(result).toEqual(document);
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "completed",
          taskId: "task-1",
          status: "success",
          percentage: 100,
        })
      );
      expect(client.getWebSocketState()).toBe("disconnected");
      if (input === "file") {
        expect(((await requests[0]!.form()).get("files") as File).name).toBe("original.pdf");
        expect(progress).toHaveBeenCalledWith(
          expect.objectContaining({ stage: "uploading", uploadedBytes: 0, totalBytes: 5 })
        );
        expect(progress).toHaveBeenCalledWith(
          expect.objectContaining({ stage: "uploaded", uploadedBytes: 5, totalBytes: 5 })
        );
      }
    }
  );

  it("isolates overlapping file and source conversions and callback ownership", async () => {
    const { client, connections } = await fixture();
    const fileProgress = vi.fn();
    const sourceProgress = vi.fn();
    const results = await Promise.all([
      client.convertFileWithWebSocket(Buffer.from("input"), "one.pdf", {}, fileProgress),
      client.convertWithWebSocket(
        { sources: [{ kind: "http", url: "https://example.test/input" }] },
        sourceProgress
      ),
    ]);
    expect(results).toEqual([document, document]);
    expect(connections).toHaveLength(2);
    const fileIds = new Set(
      fileProgress.mock.calls.map(([update]) => update.taskId).filter((id) => id !== "upload")
    );
    const sourceIds = new Set(sourceProgress.mock.calls.map(([update]) => update.taskId));
    expect(fileIds.size).toBe(1);
    expect(sourceIds.size).toBe(1);
    expect([...fileIds][0]).not.toBe([...sourceIds][0]);
  });

  // Follow-up: the newest socket can settle while an older conversion still runs.
  it.each(["success", "failure"] as const)(
    "reports the remaining connected socket when the newest task reaches %s first",
    async (newestStatus) => {
      const { client, server, connections, requests } = await fixture("pending");
      const peers = new Map<string, import("ws").WebSocket>();
      server.on("connection", (peer, request) => {
        const taskId = request.url!.split("/").pop()!;
        peers.set(taskId, peer);
        if (taskId === "task-2")
          peer.send(
            JSON.stringify({
              message: "update",
              task: { task_id: taskId, task_status: newestStatus },
            })
          );
      });
      let firstStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });
      const first = client.convertWithWebSocket(
        { sources: [{ kind: "http", url: "https://example.test/first" }] },
        () => firstStarted()
      );
      // Cleanup can disconnect this intentionally pending operation if an assertion fails.
      void first.catch(() => undefined);
      await started;
      const second = client.convertFileWithWebSocket(new Uint8Array([1]), "second.pdf");
      if (newestStatus === "success") expect(await second).toEqual(document);
      else await expect(second).rejects.toThrow("failed: failure");
      expect(connections).toEqual(["task-1", "task-2"]);
      expect(peers.get("task-1")?.readyState).toBe(1);
      expect(client.getWebSocketState()).toBe("connected");
      expect(requests.some((request) => request.url === "/v1/result/task-1")).toBe(false);
      peers.get("task-1")!.send(
        JSON.stringify({
          message: "update",
          task: { task_id: "task-1", task_status: "success" },
        })
      );
      expect(await first).toEqual(document);
      expect(client.getWebSocketState()).toBe("disconnected");
    }
  );

  it.each(["source", "file"] as const)("rejects failed %s tasks", async (input) => {
    const { client, requests } = await fixture("failure");
    const conversion =
      input === "source"
        ? client.convertWithWebSocket({
            sources: [{ kind: "http", url: "https://example.test/input" }],
          })
        : client.convertFileWithWebSocket(Buffer.from("input"), "input.pdf");
    await expect(conversion).rejects.toThrow(/WebSocket.*conversion failed/);
    expect(requests.some((request) => request.url.includes("/result/"))).toBe(false);
    expect(client.getWebSocketState()).toBe("disconnected");
  });

  it("rejects presigned content for a document conversion", async () => {
    const { client } = await fixture("success", true);
    await expect(
      client.convertWithWebSocket({
        sources: [{ kind: "http", url: "https://example.test/input" }],
      })
    ).rejects.toThrow("Unexpected presigned URL");
  });

  it("destroy settles a pending WebSocket conversion and releases the connection", async () => {
    const { client } = await fixture("pending");
    let progressSeen!: () => void;
    const seen = new Promise<void>((resolve) => {
      progressSeen = resolve;
    });
    const waiting = client.convertWithWebSocket(
      { sources: [{ kind: "http", url: "https://example.test/input" }] },
      () => progressSeen()
    );
    const rejection = expect(waiting).rejects.toThrow("monitoring disconnected");
    await seen;
    expect(client.getWebSocketState()).toBe("connected");
    client.destroy();
    await rejection;
    expect(client.getWebSocketState()).toBe("disconnected");
  });
});
