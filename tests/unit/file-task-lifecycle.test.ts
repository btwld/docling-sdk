import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient, type HttpResponse } from "../../src/api/http";
import { createAPIClient } from "../../src/docling";
import { FileService } from "../../src/services";

function response<T>(data: T): HttpResponse<T> {
  return { data, status: 200, statusText: "OK", headers: {} };
}

function createFixture(entry: "FileService" | "client.files") {
  const client = entry === "client.files" ? createAPIClient("http://localhost:5001") : undefined;
  const http = client?.getHttpClient() ?? new HttpClient({ baseUrl: "http://localhost:5001" });
  const service = client?.files ?? new FileService(http);
  const upload = vi
    .spyOn(http, "streamUpload")
    .mockResolvedValue(response({ task_id: "zip-task" }));
  const poll = vi.spyOn(http, "getJson").mockResolvedValue(response({ task_status: "success" }));
  const zipBytes = Buffer.from("PK controlled ZIP response");
  const zipStream = Readable.from([zipBytes]);
  const download = vi.spyOn(http, "requestFileStream").mockResolvedValue({
    ...response(undefined),
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="converted.zip"',
      "content-length": String(zipBytes.length),
    },
    fileStream: zipStream,
  });
  return { client, service, upload, poll, download, zipBytes, zipStream };
}

describe.each(["FileService", "client.files"] as const)(
  "%s with the real task manager",
  (entry) => {
    let fixture: ReturnType<typeof createFixture>;

    beforeEach(() => {
      vi.useFakeTimers();
      fixture = createFixture(entry);
    });

    afterEach(() => {
      fixture.service.destroy();
      fixture.client?.destroy();
      fixture.zipStream.destroy();
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    function expectClean() {
      expect(fixture.service.getTaskManager().getActiveTaskCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }

    it.each(["convertToFile", "convertToFileAsync"] as const)(
      "%s polls the uploaded task before retrieving its ZIP",
      async (method) => {
        const { service, upload, poll, download, zipBytes, zipStream } = fixture;
        poll
          .mockResolvedValueOnce(response({ task_status: "started" }))
          .mockResolvedValueOnce(response({ task_status: "success" }));
        const input = Buffer.from("controlled input");
        const conversion = service[method](input, "example.pdf", { to_formats: ["md"] });
        await vi.advanceTimersByTimeAsync(0);

        expect(upload).toHaveBeenCalledWith(
          "/v1/convert/file/async",
          [
            {
              name: "files",
              data: input,
              filename: "example.pdf",
              contentType: "application/pdf",
              size: input.length,
            },
          ],
          { to_formats: ["md"], target_type: "zip" }
        );
        expect(service.getTaskManager().getTaskInfo("zip-task")?.options).toEqual({
          timeout: 15 * 60 * 1000,
          pollInterval: 2000,
          maxPolls: 450,
          waitSeconds: 100,
          pollingRetries: 5,
        });
        expect(poll).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);
        expect(poll).toHaveBeenCalledTimes(1);
        expect(poll).toHaveBeenCalledWith("/v1/status/poll/zip-task?wait=100");
        expect(download).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1999);
        expect(poll).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);

        const result = await conversion;
        expect(poll).toHaveBeenNthCalledWith(2, "/v1/status/poll/zip-task?wait=100");
        expect(download).toHaveBeenCalledTimes(1);
        expect(download).toHaveBeenCalledWith("/v1/result/zip-task", {
          headers: { Accept: "application/zip" },
        });
        expect(result).toEqual({
          success: true,
          fileStream: zipStream,
          fileMetadata: {
            filename: "converted.zip",
            contentType: "application/zip",
            size: zipBytes.length,
          },
        });
        const chunks: Buffer[] = [];
        for await (const chunk of result.fileStream ?? []) chunks.push(chunk);
        expect(Buffer.concat(chunks)).toEqual(zipBytes);
        expectClean();
      }
    );

    it.each(["failure", "revoked"])("cleans up a %s task without downloading", async (status) => {
      const { service, poll, download } = fixture;
      poll.mockResolvedValue(response({ task_status: status }));
      const conversion = service.convertToFileAsync(Buffer.from("input"), "example.pdf", {});
      await vi.advanceTimersByTimeAsync(1000);

      await expect(conversion).resolves.toMatchObject({
        success: false,
        error: { message: `Task ${status}` },
      });
      expectClean();
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(poll).toHaveBeenCalledTimes(1);
      expect(download).not.toHaveBeenCalled();
      expectClean();
    });

    it.each(["cancel", "destroy"] as const)(
      "settles on %s and ignores an in-flight success response",
      async (action) => {
        const { service, poll, download } = fixture;
        let resolvePoll!: (value: HttpResponse<{ task_status: string }>) => void;
        poll.mockReturnValue(
          new Promise((resolve) => {
            resolvePoll = resolve;
          })
        );
        const conversion = service.convertToFile(Buffer.from("input"), "example.pdf", {});
        await vi.advanceTimersByTimeAsync(1000);
        expect(poll).toHaveBeenCalledTimes(1);

        if (action === "cancel") await service.getTaskManager().cancelTask("zip-task");
        else service.destroy();

        await expect(conversion).resolves.toMatchObject({
          success: false,
          error: { message: action === "cancel" ? "Task cancelled" : "Task manager destroyed" },
        });
        expectClean();
        resolvePoll(response({ task_status: "success" }));
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        expect(poll).toHaveBeenCalledTimes(1);
        expect(download).not.toHaveBeenCalled();
        expectClean();
      }
    );

    it("keeps unregistered task waits immediate without starting polling", async () => {
      await expect(
        fixture.service.getTaskManager().waitForCompletion("unknown")
      ).resolves.toMatchObject({
        success: false,
        error: { message: "Task not found" },
      });
      expect(fixture.poll).not.toHaveBeenCalled();
      expect(fixture.download).not.toHaveBeenCalled();
      expectClean();
    });
  }
);
