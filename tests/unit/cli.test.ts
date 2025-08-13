/**
 * Unit tests for CLI client
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DoclingCLI as DoclingCLIClass, CliUtils } from "../../src/cli";
const DoclingCLI = DoclingCLIClass as unknown as { new (config?: any): any };
import type { CliConfig, CliConvertOptions } from "../../src";

// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
}));

// Mock promisify
vi.mock("node:util", () => ({
  promisify: vi.fn((fn) => fn),
}));

describe("CliUtils", () => {
  let cliUtils: CliUtils;
  const mockConfig: CliConfig = {
    doclingPath: "docling",
    timeout: 30000,
  };

  beforeEach(() => {
    cliUtils = new CliUtils(mockConfig);
    vi.clearAllMocks();
  });

  describe("buildArgs", () => {
    it("should build command arguments correctly", () => {
      const args = cliUtils.buildArgs("convert", {
        fromFormats: ["pdf", "docx"],
        toFormats: ["md"],
        ocr: true,
        forceOcr: false,
        verbose: 2,
      });

      expect(args).toContain("convert");
      expect(args).toContain("--from-formats");
      expect(args).toContain("pdf");
      expect(args).toContain("docx");
      expect(args).toContain("--to-formats");
      expect(args).toContain("md");
      expect(args).toContain("--ocr");
      expect(args).toContain("--verbose");
      expect(args).toContain("2");
      expect(args).not.toContain("--force-ocr");
    });

    it("should handle array values correctly", () => {
      const args = cliUtils.buildArgs("convert", {
        sources: ["file1.pdf", "file2.pdf"],
        ocrLang: ["en", "fr"],
      });

      expect(args).toContain("--sources");
      expect(args).toContain("file1.pdf");
      expect(args).toContain("file2.pdf");
      expect(args).toContain("--ocr-lang");
      expect(args).toContain("en");
      expect(args).toContain("fr");
    });

    it("should skip undefined and null values", () => {
      const args = cliUtils.buildArgs("convert", {
        output: undefined,
        verbose: null,
        ocr: true,
      });

      expect(args).not.toContain("--output");
      expect(args).not.toContain("--verbose");
      expect(args).toContain("--ocr");
    });
  });

  describe("camelToKebab", () => {
    it("should convert camelCase to kebab-case", () => {
      // Access private method for testing
      const camelToKebab = (cliUtils as any).camelToKebab.bind(cliUtils);

      expect(camelToKebab("fromFormats")).toBe("from-formats");
      expect(camelToKebab("ocrEngine")).toBe("ocr-engine");
      expect(camelToKebab("simpleword")).toBe("simpleword");
      expect(camelToKebab("HTMLParser")).toBe("html-parser");
    });
  });

  describe("escapeArg", () => {
    it("should escape arguments for shell", () => {
      const escaped = cliUtils.escapeArg("file with spaces.pdf");

      if (process.platform === "win32") {
        expect(escaped).toBe('"file with spaces.pdf"');
      } else {
        expect(escaped).toBe("'file with spaces.pdf'");
      }
    });

    it("should handle quotes in arguments", () => {
      const escaped = cliUtils.escapeArg('file "with" quotes.pdf');

      if (process.platform === "win32") {
        expect(escaped).toBe('"file ""with"" quotes.pdf"');
      } else {
        expect(escaped).toContain("'file \"with\" quotes.pdf'");
      }
    });
  });

  describe("parseOutput", () => {
    it("should parse JSON output", () => {
      const jsonOutput = '{"status": "success", "data": "test"}';
      const parsed = cliUtils.parseOutput(jsonOutput, "json");

      expect(parsed).toEqual({ status: "success", data: "test" });
    });

    it("should return text output as-is", () => {
      const textOutput = "Conversion completed successfully";
      const parsed = cliUtils.parseOutput(textOutput, "text");

      expect(parsed).toBe(textOutput);
    });

    it("should throw error for invalid JSON", () => {
      const invalidJson = '{"invalid": json}';

      expect(() => cliUtils.parseOutput(invalidJson, "json")).toThrow();
    });
  });

  describe("extractOutputFiles", () => {
    it("should extract output file paths", () => {
      const stdout = `
        Processing document...
        Saved to: /path/to/output.md
        Written to: /path/to/output.json
        Conversion completed.
      `;

      const files = cliUtils.extractOutputFiles(stdout);

      expect(files).toContain("/path/to/output.md");
      expect(files).toContain("/path/to/output.json");
    });

    it("should handle empty output", () => {
      const files = cliUtils.extractOutputFiles("No output files");
      expect(files).toHaveLength(0);
    });
  });
});

describe("DoclingCLI", () => {
  let cli: InstanceType<typeof DoclingCLI>;
  const mockConfig: CliConfig = {
    doclingPath: "docling",
    timeout: 30000,
  };

  beforeEach(() => {
    cli = new DoclingCLI(mockConfig);
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should create CLI instance with default config", () => {
      const defaultCli = new DoclingCLI();
      expect(defaultCli).toBeInstanceOf(DoclingCLI);
    });

    it("should create CLI instance with custom config", () => {
      const customCli = new DoclingCLI(mockConfig);
      expect(customCli).toBeInstanceOf(DoclingCLI);
    });
  });

  describe("buildConvertArgs", () => {
    it("should build convert arguments correctly", () => {
      const options: CliConvertOptions = {
        sources: ["document.pdf"],
        toFormats: ["md"],
        ocr: true,
        ocrEngine: "easyocr",
        pdfBackend: "dlparse_v2",
      };

      // Access private method for testing
      const buildConvertArgs = (cli as any).buildConvertArgs.bind(cli);
      const args = buildConvertArgs(options);

      expect(args).toContain("convert");
      expect(args).toContain("document.pdf");
      expect(args).toContain("--to");
      expect(args).toContain("md");
      expect(args).toContain("--ocr");
      expect(args).toContain("--ocr-engine");
      expect(args).toContain("easyocr");
      expect(args).toContain("--pdf-backend");
      expect(args).toContain("dlparse_v2");
    });

    it("should handle multiple sources and formats", () => {
      const options: CliConvertOptions = {
        sources: ["doc1.pdf", "doc2.docx"],
        fromFormats: ["pdf", "docx"],
        toFormats: ["md", "json"],
      };

      const buildConvertArgs = (cli as any).buildConvertArgs.bind(cli);
      const args = buildConvertArgs(options);

      expect(args).toContain("doc1.pdf");
      expect(args).toContain("doc2.docx");
      expect(args).toContain("--from");
      expect(args).toContain("pdf");
      expect(args).toContain("docx");
      expect(args).toContain("--to");
      expect(args).toContain("md");
      expect(args).toContain("json");
    });
  });

  describe("buildModelDownloadArgs", () => {
    it("should build model download arguments", () => {
      const options = {
        outputDir: "/models",
        force: true,
        models: ["layout", "tableformer"],
      };

      const buildModelDownloadArgs = (cli as any).buildModelDownloadArgs.bind(
        cli
      );
      const args = buildModelDownloadArgs(options);

      expect(args).toContain("models");
      expect(args).toContain("download");
      expect(args).toContain("--output-dir");
      expect(args).toContain("/models");
      expect(args).toContain("--force");
      expect(args).toContain("layout");
      expect(args).toContain("tableformer");
    });

    it("should handle all models flag", () => {
      const options = { all: true, quiet: true };

      const buildModelDownloadArgs = (cli as any).buildModelDownloadArgs.bind(
        cli
      );
      const args = buildModelDownloadArgs(options);

      expect(args).toContain("--all");
      expect(args).toContain("--quiet");
    });
  });

  describe("updateConfig", () => {
    it("should update configuration", () => {
      const newConfig = { timeout: 60000 };
      cli.updateConfig(newConfig);

      const config = cli.getConfig();
      expect(config.timeout).toBe(60000);
    });
  });

  describe("getConfig", () => {
    it("should return current configuration", () => {
      const config = cli.getConfig();
      expect(config).toHaveProperty("doclingPath");
      expect(config).toHaveProperty("timeout");
    });
  });
});
