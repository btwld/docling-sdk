import { beforeAll, afterAll, vi, type MockedFunction } from "vitest";

beforeAll(() => {
  process.env.NODE_ENV = "test";

  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});

  vi.setConfig({ testTimeout: 30000 });
});

afterAll(() => {
  vi.restoreAllMocks();
});

export const testUtils = {
  delay: async (ms: number): Promise<void> => {
    const { setTimeout } = await import("node:timers/promises");
    return setTimeout(ms);
  },

  createMockFileBuffer: (content = "test content"): Buffer => {
    return Buffer.from(content);
  },

  mockFetch: (responses: Array<{ response: Response; delay?: number }>) => {
    const mockFetch = vi.fn();

    for (const config of responses) {
      if (config.delay) {
        mockFetch.mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve(config.response), config.delay)
            )
        );
      } else {
        mockFetch.mockResolvedValueOnce(config.response);
      }
    }

    global.fetch = mockFetch;
    return mockFetch;
  },

  createMockResponse: (data: unknown, status = 200, headers = {}) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({
        "content-type": "application/json",
        ...headers,
      }),
      json: vi.fn().mockResolvedValue(data),
      text: vi.fn().mockResolvedValue(JSON.stringify(data)),
      blob: vi.fn().mockResolvedValue(new Blob([JSON.stringify(data)])),
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      clone: vi.fn().mockReturnThis(),
    } as unknown as Response;
  },

  createMockErrorResponse: (message: string, status = 500) => {
    return {
      ok: false,
      status,
      statusText: message,
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new Error("Failed to parse JSON")),
      text: vi.fn().mockResolvedValue(message),
      clone: vi.fn().mockReturnThis(),
    } as unknown as Response;
  },

  restoreFetch: () => {
    if (global.fetch && vi.isMockFunction(global.fetch)) {
      (global.fetch as MockedFunction<typeof fetch>).mockRestore?.();
    }
  },

  createMockPdfBuffer: (): Buffer => {
    const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
72 720 Td
(Test Document) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
300
%%EOF`;

    return Buffer.from(pdfContent);
  },
};

// Export test constants
export const TEST_CONSTANTS = {
  MOCK_API_URL: "http://localhost:5001",
  MOCK_WS_URL: "ws://localhost:5001/ws",
  MOCK_PYTHON_PATH: "/usr/bin/python3",
  MOCK_DOCLING_PATH: "/path/to/docling",
  MOCK_TEMP_DIR: "/tmp/docling-test",
  MOCK_DOCUMENT_URL: "https://example.com/document.pdf",
  MOCK_TASK_ID: "test-task-123",
  MOCK_FILE_NAME: "test-document.pdf",
  SAMPLE_PDF_BUFFER: Buffer.from("sample pdf content"),
  SAMPLE_MARKDOWN: "# Test Document\n\nThis is a test.",
  SAMPLE_JSON: { document: { text: "test content" } },
  SAMPLE_HTML: "<h1>Test Document</h1><p>This is a test.</p>",
  SAMPLE_ZIP_HEADER: Buffer.from([0x50, 0x4b, 0x03, 0x04]), // ZIP file header
  TIMEOUT_SHORT: 5000,
  TIMEOUT_MEDIUM: 15000,
  TIMEOUT_LONG: 60000,
};
