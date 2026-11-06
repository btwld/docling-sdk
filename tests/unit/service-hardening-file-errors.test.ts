import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { HttpClient } from "../../src/api/http";
import { FileService } from "../../src/services/file";
import { loopback } from "./api-hardening-fixture";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  await Promise.all(
    cleanups
      .splice(0)
      .reverse()
      .map((cleanup) => cleanup())
  );
});

describe("file service public error outcomes", () => {
  it.each(["convertToFileAsync", "convertStreamToFile"] as const)(
    "%s returns network upload failures",
    async (method) => {
      const server = await loopback(() => ({ status: 422, body: { detail: "upload rejected" } }));
      const files = new FileService(new HttpClient({ baseUrl: server.baseUrl, retries: 0 }));
      cleanups.push(server.close, () => files.destroy());
      const result =
        method === "convertToFileAsync"
          ? await files.convertToFileAsync("content", "input.pdf", {})
          : await files.convertStreamToFile(Readable.from(["content"]), "input.pdf", {});
      expect(result).toMatchObject({ success: false, error: { message: "upload rejected" } });
      expect(server.requests).toHaveLength(1);
    }
  );

  it.each(["failure", "revoked"] as const)(
    "stream ZIP conversion returns task %s without downloading",
    async (status) => {
      const server = await loopback((request) => ({
        body: request.url.includes("/status/") ? { task_status: status } : { task_id: "task-1" },
      }));
      const files = new FileService(new HttpClient({ baseUrl: server.baseUrl, retries: 0 }));
      cleanups.push(server.close, () => files.destroy());
      expect(
        await files.convertStreamToFile(Readable.from(["input"]), "input.pdf", {})
      ).toMatchObject({ success: false, error: { message: `Task ${status}` } });
      expect(server.requests.some((request) => request.url.includes("/result/"))).toBe(false);
    }
  );

  it.each(["convertToFileAsync", "convertStreamToFile"] as const)(
    "%s rejects a successful task returning JSON",
    async (method) => {
      const server = await loopback((request) => ({
        body: request.url.includes("/status/") ? { task_status: "success" } : { task_id: "task-1" },
      }));
      const files = new FileService(new HttpClient({ baseUrl: server.baseUrl, retries: 0 }));
      cleanups.push(server.close, () => files.destroy());
      const result =
        method === "convertToFileAsync"
          ? await files.convertToFileAsync("content", "input.pdf", {})
          : await files.convertStreamToFile(Readable.from(["content"]), "input.pdf", {});
      expect(result).toMatchObject({
        success: false,
        error: { message: expect.stringContaining("Expected ZIP") },
      });
    }
  );

  it("does not accept a generic binary result as a ZIP file", async () => {
    const server = await loopback((request) => {
      if (request.url.includes("/status/")) return { body: { task_status: "success" } };
      if (request.url.includes("/result/"))
        return {
          body: Buffer.from("binary data"),
          headers: { "Content-Type": "application/octet-stream" },
        };
      return { body: { task_id: "task-1" } };
    });
    const files = new FileService(new HttpClient({ baseUrl: server.baseUrl, retries: 0 }));
    cleanups.push(server.close, () => files.destroy());
    expect(
      await files.convertStreamToFile(Readable.from(["content"]), "input.pdf", {})
    ).toMatchObject({ success: false });
  });

  it("rejects a non-object upload response without registering a task", async () => {
    const server = await loopback(() => ({
      body: "null",
      headers: { "Content-Type": "application/json" },
    }));
    const files = new FileService(new HttpClient({ baseUrl: server.baseUrl, retries: 0 }));
    cleanups.push(server.close, () => files.destroy());
    expect(
      await files.convertStreamToFile(Readable.from(["content"]), "input.pdf", {})
    ).toMatchObject({ success: false, error: { message: "Async upload failed" } });
    expect(files.getTaskManager().getActiveTaskCount()).toBe(0);
  });
});
