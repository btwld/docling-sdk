/**
 * Example: Using TypeScript Types with Docling SDK
 * 
 * This example demonstrates how to properly type your Docling clients
 * for better type safety and IDE support.
 */

import { Docling } from "../src";
import type { DoclingAPI, DoclingAPIClient, DoclingAPIClientType } from "../src";

// Example 1: Using the DoclingAPI interface for dependency injection
class DocumentProcessor {
  constructor(private readonly client: DoclingAPI) {}

  async processDocument(buffer: Buffer, filename: string) {
    // Full type safety with all API methods available
    const result = await this.client.convert(buffer, filename, {
      to_formats: ["md", "json"],
    });

    if (result.success) {
      console.log("✅ Document processed successfully");
      return result.data;
    } else {
      console.error("❌ Processing failed:", result.error?.message);
      throw new Error(result.error?.message);
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
            console.log(`Progress: ${progress.stage} - ${progress.percentage}%`);
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

// Example usage
async function main() {
  // Create a properly typed client
  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      timeout: 30000,
    },
  });

  // Use with service class
  const service = new DocumentService(client);
  
  // Use with processor
  const processor = new DocumentProcessor(client);

  console.log("✅ All types are properly configured!");
  console.log("🔧 Client type:", typeof client);
  console.log("📋 Service ready:", !!service);
  console.log("⚙️ Processor ready:", !!processor);
}

// Export for use in other examples
export {
  DocumentProcessor,
  DocumentService,
  DoclingProcessorFactory,
  createProcessor,
  processWithClient,
  main,
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
