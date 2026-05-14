import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChunkService } from "../../src/services/chunk";
import { HttpClient } from "../../src/api";
import type {
  ApiClientConfig,
  ChunkDocumentResponse,
} from "../../src/types/api";

const mockConfig: ApiClientConfig = {
  baseUrl: "http://localhost:5001",
  timeout: 30000,
};

const capturedFields: Array<Record<string, unknown>> = [];

vi.mock("../../src/api/http", async (importOriginal) => {
  const mod: any = await importOriginal();
  return {
    HttpClient: class extends mod.HttpClient {
      async streamUpload(
        _endpoint: string,
        _files: any,
        fields: Record<string, unknown>
      ) {
        capturedFields.push(fields);
        return {
          data: {
            documents: [],
            chunks: [],
            processing_time: 1,
          } satisfies ChunkDocumentResponse,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
        };
      }
    },
  };
});

describe("ChunkService.buildFormFields", () => {
  let http: HttpClient;
  let service: ChunkService;

  beforeEach(() => {
    capturedFields.length = 0;
    http = new HttpClient(mockConfig);
    service = new ChunkService(http);
  });

  it("passes list-typed conversion options as arrays (not JSON strings) to streamUpload", async () => {
    await service.chunkHybridSync(Buffer.from("pdf"), "example.pdf", {
      from_formats: ["pdf", "docx"],
      ocr_lang: ["en", "fr"],
      page_range: [1, 2],
    });

    expect(capturedFields).toHaveLength(1);
    const fields = capturedFields[0];

    expect(fields.convert_from_formats).toEqual(["pdf", "docx"]);
    expect(fields.convert_ocr_lang).toEqual(["en", "fr"]);
    expect(fields.convert_page_range).toEqual([1, 2]);

    // Guard against regression to JSON.stringify.
    expect(typeof fields.convert_from_formats).not.toBe("string");
    expect(typeof fields.convert_ocr_lang).not.toBe("string");
    expect(typeof fields.convert_page_range).not.toBe("string");
  });
});
