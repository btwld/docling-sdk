import { Docling } from "../src";

async function s3SourceExample() {
  console.log("☁️ S3 Source Integration Example");

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log("⚠️ AWS credentials not found in environment variables");
    console.log(
      "   Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to test S3 features"
    );
    console.log("   Or configure AWS credentials via AWS CLI or IAM roles");
    return;
  }

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 120000, // Longer timeout for S3 operations
    },
  });

  try {
    const s3Config = {
      bucket: process.env.S3_BUCKET!,
      key: process.env.S3_KEY!,
      region: process.env.AWS_REGION!,
    };

    // Convert document directly from S3
    const result = await client.convertFromS3(s3Config, {
      to_formats: ["md", "json"],
      do_table_structure: true,
      do_picture_description: true,
    });

    if (result.success) {
      if ("document" in result.data) {
        // ConvertDocumentResponse - has document content
        console.log("✅ S3 document conversion successful!");
        console.log(`📊 Document filename: ${result.data.document.filename}`);
        console.log(`📄 Content available: ${result.data.document.json_content ? 'Yes' : 'No'}`);

        if (result.data.document.md_content) {
          const mdLength = result.data.document.md_content.length;
          console.log(`📝 Markdown content: ${mdLength} characters`);
          console.log(`📝 Preview: ${result.data.document.md_content.slice(0, 200)}...`);
        }

        if (result.data.document.json_content) {
          console.log("🔍 JSON structure available for further processing");
        }
      } else {
        // PresignedUrlConvertDocumentResponse - only has processing stats
        console.log("✅ S3 conversion completed!");
        console.log(`📄 Documents processed: ${result.data.num_converted}`);
        console.log(`📄 Documents succeeded: ${result.data.num_succeeded}`);
        console.log(`📄 Documents failed: ${result.data.num_failed}`);
      }
    } else {
      console.error("❌ S3 conversion failed:", result.error?.message);
    }
  } catch (error) {
    console.error(
      "💥 S3 source error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function s3TargetExample() {
  console.log("\n☁️ S3 Target Upload Example");

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log("⚠️ AWS credentials not found, skipping S3 target example");
    return;
  }

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 120000,
    },
  });

  try {
    // Create a test document
    const testDocument = Buffer.from(`
# S3 Target Upload Test

This document will be processed and uploaded directly to S3.

## Features Demonstrated
- Document processing
- Direct S3 upload
- Multiple format output
- AWS integration

## Sample Content

### Performance Metrics
| Metric | Value | Target |
|--------|-------|--------|
| Throughput | 95% | 90% |
| Accuracy | 99.2% | 98% |
| Speed | 1.2s | 1.5s |

### Processing Steps
1. Document ingestion
2. Content analysis
3. Format conversion
4. S3 upload
5. Verification

## Conclusion
Direct S3 integration provides seamless cloud workflow integration.
    `);

    const s3Target = {
      bucket: process.env.S3_OUTPUT_BUCKET || "my-docling-output-bucket",
      key:
        process.env.S3_OUTPUT_KEY || `test-outputs/processed-${Date.now()}.zip`,
      region: process.env.AWS_REGION || "us-east-1",
    };

    console.log(
      `📤 Processing and uploading to S3: s3://${s3Target.bucket}/${s3Target.key}`
    );

    // Process document and upload directly to S3
    const result = await client.convertWithTarget(
      [
        {
          kind: "file",
          base64_string: testDocument.toString("base64"),
          filename: "s3-test.md",
        },
      ],
      {
        kind: "s3",
        bucket: s3Target.bucket,
        key: s3Target.key,
        region: s3Target.region,
      },
      {
        to_formats: ["md", "json", "html"],
        do_table_structure: true,
      }
    );

    if (result.success) {
      console.log("✅ S3 target upload successful!");
      console.log(
        `🎯 Results uploaded to: s3://${s3Target.bucket}/${s3Target.key}`
      );
      console.log(`📊 Processing completed successfully`);
      console.log(`🎯 Results uploaded to S3 target`);
    } else {
      console.error("❌ S3 target upload failed:", result.error?.message);
    }
  } catch (error) {
    console.error(
      "💥 S3 target error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function s3BatchProcessing() {
  console.log("\n📦 S3 Batch Processing Example");

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log("⚠️ AWS credentials not found, skipping S3 batch example");
    return;
  }

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 180000, // Extended timeout for batch processing
    },
  });

  try {
    // Define multiple S3 sources for batch processing
    const s3Sources = [
      {
        bucket: process.env.S3_BUCKET || "my-docling-input-bucket",
        key: "documents/sample-document-1.pdf",
        region: process.env.AWS_REGION || "us-east-1",
      },
      {
        bucket: process.env.S3_BUCKET || "my-docling-input-bucket",
        key: "documents/sample-document-2.pdf",
        region: process.env.AWS_REGION || "us-east-1",
      },
      {
        bucket: process.env.S3_BUCKET || "my-docling-input-bucket",
        key: "documents/sample-document-3.pdf",
        region: process.env.AWS_REGION || "us-east-1",
      },
    ];

    const outputBucket = process.env.S3_OUTPUT_BUCKET || "my-docling-output-bucket";
    const outputRegion = process.env.AWS_REGION || "us-east-1";

    console.log(`📚 Processing ${s3Sources.length} documents from S3...`);

    // Process documents in parallel with individual S3 targets
    const results = await Promise.all(
      s3Sources.map(async (source, index) => {
        try {
          console.log(
            `🔄 Processing document ${index + 1}: s3://${source.bucket}/${
              source.key
            }`
          );

          const outputKey = `test-outputs/batch-results/processed-${
            index + 1
          }-${Date.now()}.zip`;

          const result = await client.convertWithTarget(
            [{ kind: "s3", ...source }],
            {
              kind: "s3",
              bucket: outputBucket,
              key: outputKey,
              region: outputRegion,
            },
            {
              to_formats: ["md", "json"],
              do_table_structure: true,
            }
          );

          return {
            index: index + 1,
            source: `s3://${source.bucket}/${source.key}`,
            target: `s3://${outputBucket}/${outputKey}`,
            success: result.success,
            error: result.success ? null : result.error?.message,
          };
        } catch (error) {
          return {
            index: index + 1,
            source: `s3://${source.bucket}/${source.key}`,
            target: "N/A",
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      })
    );

    // Display batch results
    console.log("\n📊 S3 Batch Processing Results:");
    results.forEach(({ index, source, target, success, error }) => {
      if (success) {
        console.log(`  ✅ Document ${index}: ${source} → ${target}`);
      } else {
        console.log(`  ❌ Document ${index}: ${source} - ${error}`);
      }
    });

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `\n🎯 Batch completed: ${successCount}/${results.length} successful`
    );
  } catch (error) {
    console.error(
      "💥 S3 batch processing error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function s3WithProgress() {
  console.log("\n📊 S3 Processing with Progress Tracking");

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log("⚠️ AWS credentials not found, skipping S3 progress example");
    return;
  }

  const client = new Docling({
    api: {
      baseUrl: process.env.DOCLING_URL || "http://localhost:5001",
      apiKey: process.env.DOCLING_API_KEY,
      timeout: 120000,
    },
    progress: {
      method: "websocket",
      onProgress: (progress) => {
        const percentage = progress.percentage ?? 0;
        const stage = progress.stage || "processing";
        const progressBar =
          "█".repeat(Math.floor(percentage / 5)) +
          "░".repeat(20 - Math.floor(percentage / 5));

        process.stdout.write(
          `\r☁️ S3 ${stage}: [${progressBar}] ${percentage.toFixed(1)}%`
        );

        if (progress.uploadedBytes && progress.totalBytes) {
          const speed = progress.bytesPerSecond
            ? `${(progress.bytesPerSecond / 1024).toFixed(2)} KB/s`
            : "N/A";
          process.stdout.write(` | ${speed}`);
        }
      },
      onComplete: () => {
        console.log("\n✅ S3 processing with progress completed!");
      },
      onError: (error) => {
        console.error("\n❌ S3 progress error:", error.message);
      },
    },
  });

  try {
    const testDocument = Buffer.from(
      "# S3 Progress Test\n\nTesting S3 operations with progress tracking."
    );

    console.log("🚀 Starting S3 processing with progress tracking...");

    // Process with progress tracking
    const result = await client.convertWithTarget(
      [
        {
          kind: "file",
          base64_string: testDocument.toString("base64"),
          filename: "progress-test.md",
        },
      ],
      {
        kind: "s3",
        bucket: process.env.S3_OUTPUT_BUCKET || "protection-plus-test",
        key: `test-outputs/progress-test/result-${Date.now()}.zip`,
        region: process.env.AWS_REGION || "us-east-1",
      },
      {
        to_formats: ["md", "json"],
      }
    );

    console.log(); // New line after progress bar

    if (result.success) {
      console.log("✅ S3 processing with progress tracking successful!");
    } else {
      console.error("❌ S3 processing failed:", result.error?.message);
    }
  } catch (error) {
    console.error(
      "\n💥 S3 progress error:",
      error instanceof Error ? error.message : error
    );
  }
}

async function main() {
  console.log("☁️ Docling SDK - S3 Integration Examples");
  console.log("========================================");

  if (!process.env.DOCLING_URL) {
    console.log("💡 Using default URL: http://localhost:5001");
  }

  if (!process.env.DOCLING_API_KEY) {
    console.log("🔓 No API key provided (may be optional)");
  } else {
    console.log("🔐 API key configured");
  }

  console.log("\n📋 Environment Variables for S3 Integration:");
  console.log("   Required: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY");
  console.log("   Optional: AWS_REGION, S3_BUCKET, S3_KEY, S3_OUTPUT_BUCKET");
  console.log();

  const hasAwsCredentials = !!(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );

  if (!hasAwsCredentials) {
    console.log("⚠️ AWS credentials not found - S3 examples will be skipped");
    console.log("   Configure AWS credentials to run S3 integration examples");
    console.log();
  }

  await s3SourceExample();
  await s3TargetExample();
  await s3BatchProcessing();
  await s3WithProgress();

  console.log("\n🎉 S3 integration examples completed!");

  if (hasAwsCredentials) {
    console.log("☁️ Check your S3 buckets for processed results");
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export {
  s3SourceExample,
  s3TargetExample,
  s3BatchProcessing,
  s3WithProgress,
  main,
};
