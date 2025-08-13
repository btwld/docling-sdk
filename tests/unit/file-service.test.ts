import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileService } from "../../src/services";
import { HttpClient } from "../../src/api";
import type {
  ApiClientConfig,
  ConvertDocumentResponse,
} from "../../src/types/api";

const mockConfig: ApiClientConfig = {
  baseUrl: "http://localhost:5001",
  timeout: 30000,
};

vi.mock("../../src/services/async-task-manager", () => {
  return {
    AsyncTaskManager: class {
      async submitTask() {
        return "task-123";
      }
      async waitForCompletion() {
        return { success: true };
      }
      async getTaskResult() {
        return {
          document: { md_content: "# md" },
          status: "success",
          processing_time: 1,
        } as ConvertDocumentResponse;
      }
      destroy() {}
    },
  };
});

vi.mock("../../src/api/http", async (importOriginal) => {
  const mod: any = await importOriginal();
  return {
    HttpClient: class extends mod.HttpClient {
      async streamUpload(endpoint: string, _files: any, _fields: any) {
        if (endpoint.includes("/async")) {
          return {
            data: { task_id: "task-123" },
            status: 202,
            statusText: "Accepted",
            headers: { "content-type": "application/json" },
          };
        }
        return {
          data: {
            document: { md_content: "# md" },
            status: "success",
            processing_time: 1,
          } satisfies ConvertDocumentResponse,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
        };
      }
      async requestFileStream(_endpoint: string) {
        return {
          status: 200,
          statusText: "OK",
          headers: {
            "content-type": "application/zip",
            "content-disposition": "attachment; filename=converted_example.zip",
          },
          fileStream: new (require("node:stream").Readable)({
            read() {
              this.push(Buffer.from("PK"));
              this.push(null);
            },
          }),
          fileMetadata: {
            filename: "converted_example.zip",
            contentType: "application/zip",
          },
        };
      }
    },
  };
});

describe("FileService", () => {
  let http: HttpClient;
  let service: FileService;

  beforeEach(() => {
    http = new HttpClient(mockConfig);
    service = new FileService(http);
  });

  it("convertSync returns JSON document", async () => {
    const res = await service.convertSync(Buffer.from("pdf"), "example.pdf", {
      to_formats: ["md"],
    });
    expect(res.success).toBe(true);
    expect(
      res.success &&
        res.data &&
        "document" in res.data &&
        res.data.document.md_content
    ).toBe("# md");
  });

  it("convertToFileAsync returns ZIP stream", async () => {
    const res = await service.convertToFileAsync(
      Buffer.from("pdf"),
      "example.pdf",
      {
        to_formats: ["md"],
      }
    );
    expect(res.success).toBe(true);
    expect(res.fileStream).toBeDefined();
    expect(res.fileMetadata?.contentType).toContain("zip");
  });
});
