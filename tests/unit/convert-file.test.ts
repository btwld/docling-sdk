import { describe, it, expect, vi, beforeEach } from "vitest";
import { DoclingAPIClient } from "../../src/api";

// Mock global fetch
(global as any).fetch = vi.fn();

describe("DoclingAPIClient convertFile multipart assembly", () => {
  const cfg = {
    type: "api" as const,
    baseUrl: "http://localhost:5001",
    timeout: 30000,
  };
  let client: DoclingAPIClient;

  beforeEach(() => {
    client = new DoclingAPIClient(cfg);
    vi.clearAllMocks();
  });

  it("sync uses target_type=inbody and infers md filename and content-type", async () => {
    const calls: Array<{ url: string; init: RequestInit } | undefined> = [];
    (global as any).fetch.mockImplementation(
      async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ document: {} }),
        } as any;
      }
    );

    await client.convertFile({
      files: Buffer.from("# x"),
      from_formats: ["md"],
      to_formats: ["md"],
    });

    const fd = calls[0]?.init?.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect((fd as any).get("target_type")).toBe("inbody");
    const file: any = (fd as any).get("files");
    expect(file?.name?.endsWith?.(".md")).toBe(true);
    expect(file?.type).toBe("text/markdown");
  });

  it("async uses target_type=inbody and infers pdf filename and content-type", async () => {
    const calls: Array<{ url: string; init: RequestInit } | undefined> = [];
    (global as any).fetch.mockImplementation(
      async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ task_id: "t", task_status: "queued" }),
        } as any;
      }
    );

    await client.convertFileAsync({
      files: Buffer.from("%PDF-1.4"),
      from_formats: ["pdf"],
      to_formats: ["md"],
    });

    const fd = calls[0]?.init?.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect((fd as any).get("target_type")).toBe("inbody");
    const file: any = (fd as any).get("files");
    expect(file?.name?.endsWith?.(".pdf")).toBe(true);
    expect(file?.type).toBe("application/pdf");
  });

  it("convertFileAsyncToZip uses target_type=zip and infers pdf filename and content-type", async () => {
    const calls: Array<{ url: string; init: RequestInit } | undefined> = [];
    (global as any).fetch.mockImplementation(
      async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ task_id: "t", task_status: "queued" }),
        } as any;
      }
    );

    await client.convertFileAsyncToZip({
      files: Buffer.from("%PDF-1.4"),
      from_formats: ["pdf"],
      to_formats: ["md"],
    });

    const fd = calls[0]?.init?.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect((fd as any).get("target_type")).toBe("zip");
    const file: any = (fd as any).get("files");
    expect(file?.name?.endsWith?.(".pdf")).toBe(true);
    expect(file?.type).toBe("application/pdf");
  });

  it("respects filename hint and still sets content-type from from_formats", async () => {
    const calls: Array<{ url: string; init: RequestInit } | undefined> = [];
    (global as any).fetch.mockImplementation(
      async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ document: {} }),
        } as any;
      }
    );

    await client.convertFile({
      files: Buffer.from("# x"),
      filename: "custom.txt",
      from_formats: ["md"],
      to_formats: ["md"],
    });

    const fd = calls[0]?.init?.body as FormData;
    const file: any = (fd as any).get("files");
    expect(file?.name).toBe("custom.txt");
    expect(file?.type).toBe("text/markdown");
  });
});
