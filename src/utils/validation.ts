import type {
  CliConvertOptions,
  ConversionOptions,
  ImageExportMode,
  InputFormat,
  OcrEngine,
  OutputFormat,
  PdfBackend,
  ProcessingPipeline,
  TableMode,
} from "../types";
import { DoclingValidationError } from "../types";
import { ZodValidation } from "../validation/schemas";

/**
 * Validation result interface
 */
export interface ValidationResult<T = unknown> {
  isValid: boolean;
  errors?: string[];
  data?: T;
}

/**
 * Validation utilities
 */

export class ValidationUtils {
  /**
   * Validate input format using Zod
   */
  static validateInputFormat(format: string): format is InputFormat {
    return ZodValidation.isValidInputFormat(format);
  }

  /**
   * Validate output format using Zod
   */
  static validateOutputFormat(format: string): format is OutputFormat {
    return ZodValidation.isValidOutputFormat(format);
  }

  /**
   * Validate OCR engine
   */
  static validateOcrEngine(engine: string): engine is OcrEngine {
    return ZodValidation.isValidOcrEngine(engine);
  }

  /**
   * Validate PDF backend
   */
  static validatePdfBackend(backend: string): backend is PdfBackend {
    return ZodValidation.isValidPdfBackend(backend);
  }

  /**
   * Validate table mode
   */
  static validateTableMode(mode: string): mode is TableMode {
    return ZodValidation.isValidTableMode(mode);
  }

  /**
   * Validate image export mode
   */
  static validateImageExportMode(mode: string): mode is ImageExportMode {
    return ZodValidation.isValidImageExportMode(mode);
  }

  /**
   * Validate processing pipeline
   */
  static validateProcessingPipeline(
    pipeline: string
  ): pipeline is ProcessingPipeline {
    return ZodValidation.isValidProcessingPipeline(pipeline);
  }

  /**
   * Validate URL
   */
  static validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return ["http:", "https:"].includes(urlObj.protocol);
    } catch {
      // Ignore errors
      return false;
    }
  }

  /**
   * Validate file path
   */
  static validateFilePath(path: string): boolean {
    if (!path || typeof path !== "string") {
      return false;
    }

    return path.length > 0 && !path.includes("\0");
  }

  /**
   * Validate page range
   */
  static validatePageRange(range: [number, number]): boolean {
    if (!Array.isArray(range) || range.length !== 2) {
      return false;
    }

    const [start, end] = range;
    return (
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start > 0 &&
      end > 0 &&
      start <= end
    );
  }

  /**
   * Validate OCR languages
   */
  static validateOcrLanguages(languages: string[]): boolean {
    if (!Array.isArray(languages)) {
      return false;
    }

    return languages.every(
      (lang) => typeof lang === "string" && lang.length > 0
    );
  }

  /**
   * Validate conversion options
   */
  static validateConversionOptions(
    options: ConversionOptions
  ): ValidationResult {
    const errors: string[] = [];

    if (options.from_formats) {
      if (!Array.isArray(options.from_formats)) {
        errors.push("from_formats must be an array");
      } else {
        const invalidFormats = options.from_formats.filter(
          (format) => !ValidationUtils.validateInputFormat(format)
        );
        if (invalidFormats.length > 0) {
          errors.push(`Invalid input formats: ${invalidFormats.join(", ")}`);
        }
      }
    }

    if (options.to_formats) {
      if (!Array.isArray(options.to_formats)) {
        errors.push("to_formats must be an array");
      } else {
        const invalidFormats = options.to_formats.filter(
          (format) => !ValidationUtils.validateOutputFormat(format)
        );
        if (invalidFormats.length > 0) {
          errors.push(`Invalid output formats: ${invalidFormats.join(", ")}`);
        }
      }
    }

    if (
      options.pipeline &&
      !ValidationUtils.validateProcessingPipeline(options.pipeline)
    ) {
      errors.push(`Invalid pipeline: ${options.pipeline}`);
    }

    if (
      options.page_range &&
      !ValidationUtils.validatePageRange(options.page_range)
    ) {
      errors.push(
        "Invalid page_range: must be [start, end] where both are positive integers and start <= end"
      );
    }

    if (
      options.image_export_mode &&
      !ValidationUtils.validateImageExportMode(options.image_export_mode)
    ) {
      errors.push(`Invalid image_export_mode: ${options.image_export_mode}`);
    }

    if (
      options.ocr_engine &&
      !ValidationUtils.validateOcrEngine(options.ocr_engine)
    ) {
      errors.push(`Invalid ocr_engine: ${options.ocr_engine}`);
    }

    if (
      options.ocr_lang &&
      !ValidationUtils.validateOcrLanguages(options.ocr_lang)
    ) {
      errors.push("Invalid ocr_lang: must be an array of non-empty strings");
    }

    if (
      options.pdf_backend &&
      !ValidationUtils.validatePdfBackend(options.pdf_backend)
    ) {
      errors.push(`Invalid pdf_backend: ${options.pdf_backend}`);
    }

    if (
      options.table_mode &&
      !ValidationUtils.validateTableMode(options.table_mode)
    ) {
      errors.push(`Invalid table_mode: ${options.table_mode}`);
    }

    if (options.picture_description_area_threshold !== undefined) {
      if (
        typeof options.picture_description_area_threshold !== "number" ||
        options.picture_description_area_threshold < 0 ||
        options.picture_description_area_threshold > 1
      ) {
        errors.push(
          "picture_description_area_threshold must be a number between 0 and 1"
        );
      }
    }

    if (options.images_scale !== undefined) {
      if (
        typeof options.images_scale !== "number" ||
        options.images_scale <= 0
      ) {
        errors.push("images_scale must be a positive number");
      }
    }

    if (options.picture_description_local && options.picture_description_api) {
      errors.push(
        "picture_description_local and picture_description_api are mutually exclusive"
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate CLI convert options
   */
  static validateCliConvertOptions(
    options: CliConvertOptions
  ): ValidationResult {
    const errors: string[] = [];

    if (
      !options.sources ||
      !Array.isArray(options.sources) ||
      options.sources.length === 0
    ) {
      errors.push("sources is required and must be a non-empty array");
    } else {
      const invalidSources = options.sources.filter(
        (source) =>
          !ValidationUtils.validateUrl(source) &&
          !ValidationUtils.validateFilePath(source)
      );
      if (invalidSources.length > 0) {
        errors.push(
          `Invalid sources (must be valid URLs or file paths): ${invalidSources.join(
            ", "
          )}`
        );
      }
    }

    if (options.documentTimeout !== undefined) {
      if (
        typeof options.documentTimeout !== "number" ||
        options.documentTimeout <= 0
      ) {
        errors.push("documentTimeout must be a positive number");
      }
    }

    if (options.numThreads !== undefined) {
      if (!Number.isInteger(options.numThreads) || options.numThreads <= 0) {
        errors.push("numThreads must be a positive integer");
      }
    }

    if (options.verbose !== undefined) {
      if (!Number.isInteger(options.verbose) || options.verbose < 0) {
        errors.push("verbose must be a non-negative integer");
      }
    }

    if (options.pictureDescriptionAreaThreshold !== undefined) {
      if (
        typeof options.pictureDescriptionAreaThreshold !== "number" ||
        options.pictureDescriptionAreaThreshold < 0 ||
        options.pictureDescriptionAreaThreshold > 1
      ) {
        errors.push(
          "pictureDescriptionAreaThreshold must be a number between 0 and 1"
        );
      }
    }

    if (options.headers) {
      try {
        JSON.parse(options.headers);
      } catch {
        // Ignore errors
        errors.push("headers must be a valid JSON string");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Throw validation error if options are invalid
   */
  static assertValidConversionOptions(options: ConversionOptions): void {
    const result = ValidationUtils.validateConversionOptions(options);
    if (!result.isValid) {
      throw new DoclingValidationError(
        `Invalid conversion options: ${
          result.errors?.join(", ") || "Unknown error"
        }`,
        "conversion_options",
        options
      );
    }
  }

  /**
   * Throw validation error if CLI options are invalid
   */
  static assertValidCliConvertOptions(options: CliConvertOptions): void {
    const result = ValidationUtils.validateCliConvertOptions(options);
    if (!result.isValid) {
      throw new DoclingValidationError(
        `Invalid CLI convert options: ${
          result.errors?.join(", ") || "Unknown error"
        }`,
        "cli_convert_options",
        options
      );
    }
  }

  /**
   * Validate conversion options using Zod with detailed error reporting
   */
  static validateConversionOptionsWithZod(
    options: unknown
  ): ValidationResult<ConversionOptions> {
    try {
      const validated = ZodValidation.validateConversionOptions(options);
      return { isValid: true, data: validated as ConversionOptions };
    } catch (error) {
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : "Validation failed"],
      };
    }
  }

  /**
   * Safe validation that returns Zod result
   */
  static safeValidateConversionOptions(options: unknown) {
    return ZodValidation.safeValidateConversionOptions(options);
  }

  /**
   * Validate CLI convert options using Zod
   */
  static validateCliConvertOptionsWithZod(
    options: unknown
  ): ValidationResult<CliConvertOptions> {
    try {
      const validated = ZodValidation.validateCliConvertOptions(options);
      return { isValid: true, data: validated as unknown as CliConvertOptions };
    } catch (error) {
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : "Validation failed"],
      };
    }
  }
}
