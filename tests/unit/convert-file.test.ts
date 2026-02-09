import { describe, it, expect, vi, beforeEach } from "vitest";
import { DoclingAPIClient } from "../../src/api";

// Store captured FormData from requests
let capturedFormData: FormData | null = null;

// Create mock response
const createMockRawResponse = (data: unknown) => ({
  _data: data,
  status: 200,
  statusText: "OK",
  headers: new Headers({ "content-type": "application/json" }),
});

// Create mock fetcher that captures FormData
const mockRawFetcher = vi.fn().mockImplementation(async (_url: string, options?: { body?: FormData }) => {
  if (options?.body instanceof FormData) {
    capturedFormData = options.body;
  }
  // Return mock response based on URL
  if (_url.includes("/async")) {
    return createMockRawResponse({ task_id: "test-task-id", task_status: "pending" });
  }
  return createMockRawResponse({ document: {} });
});

const mockFetcher = Object.assign(vi.fn(), {
  raw: mockRawFetcher,
});

// Mock ofetch module with create function
vi.mock("ofetch", () => ({
  ofetch: Object.assign(vi.fn(), {
    create: vi.fn(() => mockFetcher),
    raw: vi.fn(),
  }),
  $fetch: vi.fn(),
  FetchError: class FetchError extends Error {
    statusCode?: number;
    data?: unknown;
  },
}));

describe("DoclingAPIClient convertFile multipart assembly", () => {
  const cfg = {
    type: "api" as const,
    baseUrl: "http://localhost:5001",
    timeout: 30000,
  };
  let client: DoclingAPIClient;

  beforeEach(() => {
    client = new DoclingAPIClient(cfg);
    capturedFormData = null;
    vi.clearAllMocks();
  });

  it("sync uses target_type=inbody and infers md filename and content-type", async () => {
    await client.convertFile({
      files: Buffer.from("# x"),
      from_formats: ["md"],
      to_formats: ["md"],
    });

    expect(capturedFormData).toBeInstanceOf(FormData);
    expect(capturedFormData?.get("target_type")).toBe("inbody");
    const file = capturedFormData?.get("files") as File | null;
    expect(file?.name?.endsWith?.(".md")).toBe(true);
    expect(file?.type).toBe("text/markdown");
  });

  it("async uses target_type=inbody and infers pdf filename and content-type", async () => {
    await client.convertFileAsync({
      files: Buffer.from("%PDF-1.4"),
      from_formats: ["pdf"],
      to_formats: ["md"],
    });

    expect(capturedFormData).toBeInstanceOf(FormData);
    expect(capturedFormData?.get("target_type")).toBe("inbody");
    const file = capturedFormData?.get("files") as File | null;
    expect(file?.name?.endsWith?.(".pdf")).toBe(true);
    expect(file?.type).toBe("application/pdf");
  });

  it("convertFileAsyncToZip uses target_type=zip and infers pdf filename and content-type", async () => {
    await client.convertFileAsyncToZip({
      files: Buffer.from("%PDF-1.4"),
      from_formats: ["pdf"],
      to_formats: ["md"],
    });

    expect(capturedFormData).toBeInstanceOf(FormData);
    expect(capturedFormData?.get("target_type")).toBe("zip");
    const file = capturedFormData?.get("files") as File | null;
    expect(file?.name?.endsWith?.(".pdf")).toBe(true);
    expect(file?.type).toBe("application/pdf");
  });

  it("respects filename hint and still sets content-type from from_formats", async () => {
    await client.convertFile({
      files: Buffer.from("# x"),
      filename: "custom.txt",
      from_formats: ["md"],
      to_formats: ["md"],
    });

    const file = capturedFormData?.get("files") as File | null;
    expect(file?.name).toBe("custom.txt");
    expect(file?.type).toBe("text/markdown");
  });
});
