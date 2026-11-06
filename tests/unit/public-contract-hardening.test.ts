import { describe, expect, it } from "vitest";
import {
  DoclingUtils,
  DoclingValidationError,
  DoclingTimeoutError,
  DoclingFileError,
  ValidationUtils,
  ZodValidation,
  createFailureResult,
  createSuccessResult,
  hasDocumentContent,
  isConversionFailure,
  isConversionSuccess,
  isPresignedUrlResponse,
  isTargetConversionSuccess,
  tryAsync,
} from "../../src/index";
import type { CliConvertOptions, ConversionOptions } from "../../src/types";
import * as browser from "../../src/browser-entry";

describe("public validation contracts", () => {
  it("accepts the documented API options without losing fields", () => {
    const options: ConversionOptions = {
      from_formats: ["pdf"],
      to_formats: ["md", "json"],
      pipeline: "standard",
      ocr_lang: ["en"],
      page_range: [1, 2],
      force_ocr: false,
      chunking_max_tokens: null,
      chunking_include_raw_text: true,
      chunking_use_markdown_tables: true,
      chunking_merge_peers: false,
      chunking_tokenizer: "test-tokenizer",
      picture_description_local: {
        repo_id: "test/model",
        generation_config: { max_new_tokens: 4 },
      },
    };
    expect(ZodValidation.validateConversionOptions(options)).toEqual(options);
    expect(ValidationUtils.validateConversionOptionsWithZod(options)).toEqual({
      isValid: true,
      data: options,
    });
    expect(ValidationUtils.safeValidateConversionOptions(options).success).toBe(true);
  });

  it("accepts camel-case CLI options as declared by the public interface", () => {
    const options: CliConvertOptions = {
      sources: ["report.pdf"],
      fromFormats: ["pdf"],
      toFormats: ["html_split_page"],
      output: "output",
      pipeline: "standard",
      vlmModel: "smoldocling",
      asrModel: "whisper_tiny",
      ocr: false,
      forceOcr: true,
      ocrEngine: "rapidocr",
      ocrLang: ["en"],
      pdfBackend: "dlparse_v4",
      tableMode: "accurate",
      imageExportMode: "referenced",
      showLayout: true,
      enrichCode: false,
      enrichFormula: false,
      enrichPictureClasses: false,
      enrichPictureDescriptions: false,
      pictureDescriptionAreaThreshold: 0.2,
      abortOnError: true,
      documentTimeout: 30,
      numThreads: 2,
      device: "cpu",
      artifactsPath: "models",
      allowExternalPlugins: false,
      enableRemoteServices: false,
      showExternalPlugins: false,
      debugVisualizeCells: false,
      debugVisualizeOcr: false,
      debugVisualizeLayout: false,
      debugVisualizeTables: false,
      headers: '{"X-Test":"yes"}',
      verbose: 2,
    };
    expect(ZodValidation.validateCliConvertOptions(options)).toEqual(options);
    expect(ValidationUtils.validateCliConvertOptionsWithZod(options)).toEqual({
      isValid: true,
      data: options,
    });
    expect(() => ValidationUtils.assertValidCliConvertOptions(options)).not.toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite numeric limits (%s) through both validation surfaces",
    (value) => {
      for (const options of [
        { images_scale: value },
        { picture_description_area_threshold: value },
      ]) {
        expect(ValidationUtils.validateConversionOptions(options).isValid).toBe(false);
        expect(ZodValidation.safeValidateConversionOptions(options).success).toBe(false);
      }
      for (const options of [
        { documentTimeout: value },
        { pictureDescriptionAreaThreshold: value },
      ]) {
        expect(
          ValidationUtils.validateCliConvertOptions({ sources: ["x.pdf"], ...options }).isValid
        ).toBe(false);
        expect(
          ValidationUtils.validateCliConvertOptionsWithZod({ sources: ["x.pdf"], ...options })
            .isValid
        ).toBe(false);
      }
    }
  );

  it.each(["not-json", "null", "[]", '{"X-Test":7}'])(
    "rejects invalid CLI header objects: %s",
    (headers) => {
      expect(
        ValidationUtils.validateCliConvertOptionsWithZod({ sources: ["x.pdf"], headers }).isValid
      ).toBe(false);
    }
  );

  it("reports invalid enums, ranges and incompatible options together", () => {
    const bad = {
      from_formats: ["invalid"],
      to_formats: ["invalid"],
      pipeline: "invalid",
      page_range: [3, 1],
      image_export_mode: "invalid",
      ocr_engine: "invalid",
      ocr_lang: [""],
      pdf_backend: "invalid",
      table_mode: "invalid",
      images_scale: -1,
      picture_description_area_threshold: 2,
      picture_description_local: {},
      picture_description_api: {},
    } as unknown as ConversionOptions;
    const result = ValidationUtils.validateConversionOptions(bad);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("input formats"),
        expect.stringContaining("output formats"),
        expect.stringContaining("pipeline"),
        expect.stringContaining("page_range"),
        expect.stringContaining("image_export_mode"),
        expect.stringContaining("ocr_engine"),
        expect.stringContaining("ocr_lang"),
        expect.stringContaining("pdf_backend"),
        expect.stringContaining("table_mode"),
        expect.stringContaining("images_scale"),
        expect.stringContaining("mutually exclusive"),
      ])
    );
    expect(() => ValidationUtils.assertValidConversionOptions(bad)).toThrow(DoclingValidationError);
    expect(ValidationUtils.validateConversionOptionsWithZod(bad).isValid).toBe(false);
  });

  it("keeps zero/false values and valid local paths while rejecting malformed input", () => {
    expect(
      ValidationUtils.validateConversionOptions({
        images_scale: 1,
        picture_description_area_threshold: 0,
        do_ocr: false,
      }).isValid
    ).toBe(true);
    expect(() =>
      ValidationUtils.assertValidConversionOptions({ to_formats: ["md"] })
    ).not.toThrow();
    expect(
      ValidationUtils.validateCliConvertOptions({
        sources: ["https://example.com/x.pdf", "file with spaces.pdf"],
        verbose: 0,
      }).isValid
    ).toBe(true);
    expect(
      ValidationUtils.validateCliConvertOptions({
        sources: [],
        numThreads: 0,
        verbose: -1,
        headers: "{",
      }).errors
    ).toHaveLength(4);
    expect(() => ValidationUtils.assertValidCliConvertOptions({ sources: ["bad\0file"] })).toThrow(
      DoclingValidationError
    );
    expect(
      ValidationUtils.validateConversionOptions({ from_formats: "pdf", to_formats: "md" } as never)
        .errors
    ).toHaveLength(2);
    expect(ValidationUtils.validatePageRange([1, 1])).toBe(true);
    expect(ValidationUtils.validatePageRange([1] as never)).toBe(false);
    expect(ValidationUtils.validateOcrLanguages("en" as never)).toBe(false);
    expect(ValidationUtils.validateFilePath(3 as never)).toBe(false);
  });

  it("validates config and progress/task/result messages at public boundaries", () => {
    expect(
      ZodValidation.validateApiClientConfig({ baseUrl: "http://localhost", retries: 0 }).retries
    ).toBe(0);
    expect(() => ZodValidation.validateApiClientConfig({ baseUrl: "file:///tmp/x" })).toThrow();
    expect(ZodValidation.validateCliClientConfig({ pythonPath: "python3" }).pythonPath).toBe(
      "python3"
    );
    expect(
      ZodValidation.validateProgressUpdate({ stage: "converting", percentage: 50, timestamp: 1 })
        .percentage
    ).toBe(50);
    expect(() =>
      ZodValidation.validateProgressUpdate({ stage: "converting", percentage: 101, timestamp: 1 })
    ).toThrow();
    expect(
      ZodValidation.validateTaskStatusResponse({ task_id: "a", task_status: "success" }).task_status
    ).toBe("success");
    expect(ZodValidation.isValidTaskStatus("unrecognized")).toBe(false);
    expect(
      ZodValidation.validateConversionResult({ success: false, error: { message: "failed" } }).error
        ?.message
    ).toBe("failed");
  });
});

describe("consumer results, errors and entry points", () => {
  it("distinguishes a resolved conversion failure from a rejected operation", async () => {
    const failure = createFailureResult({ message: "incomplete conversion" }, "task-1");
    const wrapped = await tryAsync(async () => failure);
    expect(wrapped.success).toBe(true);
    if (wrapped.success) {
      expect(isConversionFailure(wrapped.data)).toBe(true);
      expect(wrapped.data.error.message).toBe("incomplete conversion");
    }
    const operationError = new Error("transport failed");
    expect(
      await tryAsync(async () => {
        throw operationError;
      })
    ).toEqual({ success: false, error: operationError });
    const data = {
      document: { filename: "x.pdf", md_content: "text" },
      status: "success" as const,
      processing_time: 0,
    };
    const success = createSuccessResult(data, "task-2");
    expect(isConversionSuccess(success)).toBe(true);
    expect(hasDocumentContent(success.data)).toBe(true);
    expect(isPresignedUrlResponse(success.data)).toBe(false);
    const target = { success: true as const, data: { url: "https://example.com/output.zip" } };
    expect(isTargetConversionSuccess(target as never)).toBe(true);
    expect(isPresignedUrlResponse(target.data as never)).toBe(true);
  });

  it("preserves actionable SDK error details", () => {
    const validation = new DoclingValidationError("invalid", "page_range", [3, 1]);
    expect(validation).toBeInstanceOf(Error);
    expect(validation).toMatchObject({
      name: "DoclingValidationError",
      code: "VALIDATION_ERROR",
      field: "page_range",
      value: [3, 1],
    });
    expect(new DoclingTimeoutError(10, "convert").message).toContain(
      "convert timed out after 10ms"
    );
    expect(new DoclingTimeoutError(10).message).toContain("unknown");
    expect(new DoclingFileError("unreadable", "x.pdf", 2)).toMatchObject({
      code: "FILE_ERROR",
      filePath: "x.pdf",
      fileSize: 2,
    });
  });

  it("makes path syntax and human-readable metadata utilities useful without filesystem claims", () => {
    expect(DoclingUtils.isValidFilePath("not-created.pdf")).toBe(true);
    expect(DoclingUtils.isValidFilePath("bad\0name.pdf")).toBe(false);
    expect(DoclingUtils.isValidFilePath(3 as never)).toBe(false);
    expect(DoclingUtils.isSupportedFileExtension("REPORT.PDF")).toBe(true);
    expect(DoclingUtils.isSupportedFileExtension("no-extension")).toBe(false);
    expect(DoclingUtils.formatFileSize(1024)).toBe("1.0 KB");
    expect(DoclingUtils.formatFileSize(7)).toBe("7 B");
  });

  it("creates browser-entry API/Web clients without selecting a local backend", () => {
    const api = browser.createAPIClient("http://localhost", { retries: 0 });
    const web = browser.createWebClient();
    expect(browser.isAPIClient(api)).toBe(true);
    expect(browser.isAPIClient(web)).toBe(false);
    expect(browser.isWebClient(web)).toBe(true);
    expect(browser.isWebClient(api)).toBe(false);
    expect(browser).not.toHaveProperty("DoclingCLIClient");
    api.destroy();
    web.destroy();
  });
});
