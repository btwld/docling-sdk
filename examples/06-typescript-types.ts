/**
 * Example: Using TypeScript Types with Docling SDK
 *
 * Demonstrates proper typing for Docling clients with full type safety.
 */

import { Docling } from "../src";
import type {
  DoclingAPI,
  DoclingAPIClient,
  DoclingAPIClientType,
  ConversionResult,
} from "../src";

// Example 1: Using the DoclingAPI interface for dependency injection
class DocumentProcessor {
  constructor(private readonly client: DoclingAPI) {}

  async processDocument(buffer: Buffer, filename: string) {
    // Full type safety with all API methods available
    const result = await this.client.convert(buffer, filename, {
      to_formats: ["md", "json"],
    });

    if (result.success === true) {
      console.log("✅ Document processed successfully");
      return result.data;
    } else {
      console.error("❌ Processing failed:", result.error.message);
      throw new Error(result.error.message);
    }
  }

  async checkHealth() {
    // Type-safe access to API-specific methods
    return await this.client.health();
  }

  async processFromUrl(url: string) {
    // Access to convenience methods with full typing
    return await this.client.convertFromUrl(url, {
      to_formats: ["md"],
    });
  }
}

// Example 2: Using DoclingAPIClient type directly
function createProcessor(client: DoclingAPIClient): DocumentProcessor {
  return new DocumentProcessor(client);
}

// Example 3: Using the convenience DoclingAPIClientType
function processWithClient(client: DoclingAPIClientType) {
  // This type is equivalent to DoclingAPIClient but more convenient
  return client.convert(Buffer.from("test"), "test.pdf");
}

// Example 4: Factory pattern with proper typing
interface ProcessorFactory {
  createProcessor(): DocumentProcessor;
}

class DoclingProcessorFactory implements ProcessorFactory {
  constructor(private readonly baseUrl: string) {}

  createProcessor(): DocumentProcessor {
    // Create client with proper typing
    const client = new Docling({
      api: {
        baseUrl: this.baseUrl,
        timeout: 30000,
      },
    });

    return new DocumentProcessor(client);
  }
}

// Example 5: Service class with injected client
class DocumentService {
  constructor(private readonly doclingClient: DoclingAPI) {}

  async convertDocument(
    file: Buffer,
    filename: string,
    format: "md" | "json" | "html" = "md"
  ) {
    try {
      // Type-safe method calls with progress tracking
      const result = await this.doclingClient.convert(
        file,
        filename,
        { to_formats: [format] },
        {
          method: "websocket",
          onProgress: (progress) => {
            console.log(
              `Progress: ${progress.stage} - ${progress.percentage}%`
            );
          },
        }
      );

      return result;
    } catch (error) {
      console.error("Conversion error:", error);
      throw error;
    }
  }

  async batchProcess(files: Array<{ buffer: Buffer; filename: string }>) {
    const results = [];

    for (const file of files) {
      try {
        const result = await this.convertDocument(file.buffer, file.filename);
        results.push({ filename: file.filename, result });
      } catch (error) {
        results.push({ filename: file.filename, error });
      }
    }

    return results;
  }

  // Access to advanced API features with full typing
  async processFromS3(bucket: string, key: string) {
    return await this.doclingClient.convertFromS3({
      bucket,
      key,
      region: "us-east-1",
    });
  }

  async getTaskStatus(taskId: string) {
    return await this.doclingClient.pollTaskStatus(taskId);
  }
}

// Example 6: Clean error handling with try/catch
class TypeSafetyExamples {
  constructor(private readonly client: DoclingAPI) {}

  // Approach 1: Simple try/catch (recommended)
  async simpleTryCatch(buffer: Buffer, filename: string) {
    try {
      const result = await this.client.convertFile({
        files: buffer,
        filename,
        to_formats: ["md"],
      });

      // Direct access to document - no nested data!
      console.log("Document:", result.document.filename);
      console.log("Status:", result.status);
      return result;
    } catch (error) {
      console.error("Conversion failed:", error.message);
      throw error;
    }
  }

  // Approach 2: With custom error handling
  async customErrorHandling(buffer: Buffer, filename: string) {
    try {
      const result = await this.client.convertFile({
        files: buffer,
        filename,
        to_formats: ["md", "json"],
      });

      // Direct access - clean and simple!
      console.log("Document:", result.document.filename);
      console.log("Markdown length:", result.document.md_content?.length || 0);
      console.log("JSON available:", !!result.document.json_content);
      return result;
    } catch (error) {
      // Custom error handling
      if (error.message.includes("timeout")) {
        console.error("Conversion timed out, retrying...");
        // Could implement retry logic here
      } else {
        console.error("Conversion failed:", error.message);
      }
      throw error;
    }
  }

  // Approach 3: Multiple formats with validation
  async multipleFormats(buffer: Buffer, filename: string) {
    try {
      const result = await this.client.convertFile({
        files: buffer,
        filename,
        to_formats: ["md", "json", "html"],
      });

      // Validate what we got back
      const formats = {
        markdown: !!result.document.md_content,
        json: !!result.document.json_content,
        html: !!result.document.html_content,
      };

      console.log("Available formats:", formats);
      console.log("Document:", result.document.filename);

      return { result, formats };
    } catch (error) {
      console.error("Multi-format conversion failed:", error.message);
      throw error;
    }
  }

  // Approach 4: Utility wrapper
  async utilityWrapper(buffer: Buffer, filename: string) {
    return this.safeConvert(buffer, filename);
  }

  private async safeConvert(buffer: Buffer, filename: string) {
    try {
      const result = await this.client.convertFile({
        files: buffer,
        filename,
        to_formats: ["md"],
      });

      return {
        success: true as const,
        document: result.document,
        status: result.status,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error.message,
      };
    }
  }
}

async function main() {
  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      timeout: 30000,
    },
  });

  const service = new DocumentService(client);
  const processor = new DocumentProcessor(client);

  console.log("✅ All types are properly configured!");
  console.log("🔧 Client type:", typeof client);
  console.log("📋 Service ready:", !!service);
  console.log("⚙️ Processor ready:", !!processor);
}

export {
  DocumentProcessor,
  DocumentService,
  DoclingProcessorFactory,
  TypeSafetyExamples,
  createProcessor,
  processWithClient,
  main,
};
if (require.main === module) {
  main().catch(console.error);
}
