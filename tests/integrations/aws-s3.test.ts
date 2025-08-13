// import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
// import { pipeline } from "node:stream/promises";
// import { Transform, PassThrough } from "node:stream";
// import { createGzip } from "node:zlib";
// import {
//   S3Client,
//   CreateBucketCommand,
//   DeleteBucketCommand,
//   ListObjectsV2Command,
//   DeleteObjectCommand,
//   HeadObjectCommand,
// } from "@aws-sdk/client-s3";
// import { Upload } from "@aws-sdk/lib-storage";
// import { Docling } from "../../src";

// // Skip these tests if AWS credentials not available or explicitly disabled
// const skipAWSTests =
//   !process.env.AWS_ACCESS_KEY_ID ||
//   process.env.AWS_SKIP_TESTS === "true" ||
//   process.env.CI === "true";

// describe.skipIf(skipAWSTests)("AWS S3 Integration", () => {
//   let s3Client: S3Client;
//   let docling: any;
//   let testBucket: string;
//   const testObjects: string[] = [];

//   beforeAll(async () => {
//     console.log("🔧 Setting up AWS S3 integration tests...");

//     s3Client = new S3Client({
//       region: process.env.AWS_REGION || "us-east-1",
//       credentials: {
//         accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
//         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
//       },
//     });

//     docling = new Docling({
//       api: {
//         baseUrl:
//           process.env.DOCLING_API_URL ||
//           "https://docling-serve-production-c835.up.railway.app",
//         timeout: 30000,
//       },
//     });

//     // Create unique test bucket
//     testBucket = `docling-test-${Date.now()}-${Math.random()
//       .toString(36)
//       .substring(7)}`;

//     try {
//       await s3Client.send(new CreateBucketCommand({ Bucket: testBucket }));
//       console.log(`✅ Test bucket created: ${testBucket}`);
//     } catch (error: any) {
//       console.error(`❌ Failed to create test bucket: ${error.message}`);
//       throw error;
//     }
//   }, 30000);

//   afterAll(async () => {
//     if (!testBucket) return;

//     try {
//       // Delete all test objects
//       for (const key of testObjects) {
//         try {
//           await s3Client.send(
//             new DeleteObjectCommand({
//               Bucket: testBucket,
//               Key: key,
//             })
//           );
//         } catch (error) {
//           console.warn(`Failed to delete object ${key}:`, error);
//         }
//       }

//       // Delete test bucket
//       await s3Client.send(new DeleteBucketCommand({ Bucket: testBucket }));
//       console.log(`🗑️  Test bucket deleted: ${testBucket}`);
//     } catch (error: any) {
//       console.error(`❌ Failed to cleanup test bucket: ${error.message}`);
//     }
//   }, 30000);

//   beforeEach(() => {
//     // Clear test objects list for each test
//     testObjects.length = 0;
//   });

//   it("should upload ZIP stream directly to S3", async () => {
//     const testKey = "test/direct-zip-upload.zip";
//     testObjects.push(testKey);

//     // Create test PDF buffer
//     const pdfBuffer = Buffer.from("%PDF-1.4\nfake pdf content for testing");

//     // Get ZIP file from Docling
//     const zipResult = await docling.convertToFile(pdfBuffer, "test.pdf", {
//       to_formats: ["md", "json"],
//     });

//     expect(zipResult.success).toBe(true);
//     expect(zipResult.fileStream).toBeDefined();

//     // Upload directly to S3
//     const upload = new Upload({
//       client: s3Client,
//       params: {
//         Bucket: testBucket,
//         Key: testKey,
//         Body: zipResult.fileStream as any,
//         ContentType: "application/zip",
//       },
//     });

//     const result = await upload.done();

//     expect(result.ETag).toBeDefined();
//     expect(result.Location).toContain(testBucket);
//     expect(result.Location).toContain(testKey);

//     // Verify object exists in S3
//     const headResult = await s3Client.send(
//       new HeadObjectCommand({
//         Bucket: testBucket,
//         Key: testKey,
//       })
//     );

//     expect(headResult.ContentType).toBe("application/zip");
//     expect(headResult.ContentLength).toBeGreaterThan(0);
//   }, 60000);

//   it("should handle pipeline with compression", async () => {
//     const testKey = "test/pipeline-compressed.zip.gz";
//     testObjects.push(testKey);

//     const pdfBuffer = Buffer.from(
//       "%PDF-1.4\ntest content for compression pipeline"
//     );

//     // Get ZIP file from Docling
//     const zipResult = await docling.convertToFile(pdfBuffer, "test.pdf", {
//       to_formats: ["md"],
//     });

//     expect(zipResult.success).toBe(true);
//     expect(zipResult.fileStream).toBeDefined();

//     const sourceStream = zipResult.fileStream;

//     // Create S3 destination
//     const s3Destination = new PassThrough();
//     const upload = new Upload({
//       client: s3Client,
//       params: {
//         Bucket: testBucket,
//         Key: testKey,
//         Body: s3Destination,
//         ContentType: "application/zip",
//         ContentEncoding: "gzip",
//       },
//     });

//     // Pipeline: Docling → Gzip → S3
//     const [uploadResult] = await Promise.all([
//       upload.done(),
//       pipeline(sourceStream, createGzip(), s3Destination),
//     ]);

//     expect(uploadResult.ETag).toBeDefined();

//     // Verify compressed object
//     const headResult = await s3Client.send(
//       new HeadObjectCommand({
//         Bucket: testBucket,
//         Key: testKey,
//       })
//     );

//     expect(headResult.ContentEncoding).toBe("gzip");
//   }, 60000);

//   it("should track upload progress", async () => {
//     const testKey = "test/progress-tracking.zip";
//     testObjects.push(testKey);

//     const pdfBuffer = Buffer.from(
//       "%PDF-1.4\ntest content for progress tracking"
//     );

//     const sourceStream = await docling.getConversionStream(
//       pdfBuffer,
//       "test.pdf",
//       { to_formats: ["md", "json", "html"] },
//       true
//     );

//     let progressEvents = 0;
//     let totalBytes = 0;

//     // Progress tracking transform
//     const progressTransform = new Transform({
//       transform(chunk: Buffer, _encoding, callback) {
//         totalBytes += chunk.length;
//         progressEvents++;
//         this.push(chunk);
//         callback();
//       },
//     });

//     const s3Destination = new PassThrough();
//     const upload = new Upload({
//       client: s3Client,
//       params: {
//         Bucket: testBucket,
//         Key: testKey,
//         Body: s3Destination,
//         ContentType: "application/zip",
//       },
//     });

//     let uploadProgressEvents = 0;
//     upload.on("httpUploadProgress", () => {
//       uploadProgressEvents++;
//     });

//     const [uploadResult] = await Promise.all([
//       upload.done(),
//       pipeline(sourceStream, progressTransform, s3Destination),
//     ]);

//     expect(uploadResult.ETag).toBeDefined();
//     expect(progressEvents).toBeGreaterThan(0);
//     expect(totalBytes).toBeGreaterThan(0);
//     expect(uploadProgressEvents).toBeGreaterThan(0);
//   }, 60000);

//   it("should handle multipart upload automatically", async () => {
//     const testKey = "test/multipart-auto.zip";
//     testObjects.push(testKey);

//     const pdfBuffer = Buffer.from(
//       "%PDF-1.4\ntest content for multipart upload"
//     );

//     const sourceStream = await docling.getConversionStream(
//       pdfBuffer,
//       "test.pdf",
//       { to_formats: ["md", "json", "html"] },
//       true
//     );

//     const upload = new Upload({
//       client: s3Client,
//       params: {
//         Bucket: testBucket,
//         Key: testKey,
//         Body: sourceStream,
//         ContentType: "application/zip",
//       },
//       partSize: 5 * 1024 * 1024, // 5MB parts
//       queueSize: 4,
//     });

//     let partsUploaded = 0;
//     upload.on("httpUploadProgress", (progress) => {
//       if (progress.part !== undefined) {
//         partsUploaded = Math.max(partsUploaded, progress.part);
//       }
//     });

//     const result = await upload.done();

//     expect(result.ETag).toBeDefined();
//     // Note: Small test files might not trigger multipart, that's OK
//   }, 60000);

//   it("should handle concurrent uploads", async () => {
//     const files = [
//       { buffer: Buffer.from("%PDF-1.4\ntest file 1"), name: "test1.pdf" },
//       { buffer: Buffer.from("%PDF-1.4\ntest file 2"), name: "test2.pdf" },
//       { buffer: Buffer.from("%PDF-1.4\ntest file 3"), name: "test3.pdf" },
//     ];

//     const uploadPromises = files.map(async (file, index) => {
//       const testKey = `test/concurrent-${index + 1}.zip`;
//       testObjects.push(testKey);

//       const sourceStream = await docling.getConversionStream(
//         file.buffer,
//         file.name,
//         { to_formats: ["md"] },
//         true
//       );

//       const upload = new Upload({
//         client: s3Client,
//         params: {
//           Bucket: testBucket,
//           Key: testKey,
//           Body: sourceStream,
//           ContentType: "application/zip",
//         },
//       });

//       return upload.done();
//     });

//     const results = await Promise.all(uploadPromises);

//     expect(results).toHaveLength(3);
//     results.forEach((result) => {
//       expect(result.ETag).toBeDefined();
//     });

//     // Verify all objects exist
//     const listResult = await s3Client.send(
//       new ListObjectsV2Command({
//         Bucket: testBucket,
//         Prefix: "test/concurrent-",
//       })
//     );

//     expect(listResult.Contents).toHaveLength(3);
//   }, 90000);

//   it("should handle content streaming (non-ZIP)", async () => {
//     const testKey = "test/content-stream.md";
//     testObjects.push(testKey);

//     const pdfBuffer = Buffer.from(
//       "%PDF-1.4\ntest content for markdown conversion"
//     );

//     // Get content stream (not ZIP)
//     const result = await docling.convertFile({
//       files: pdfBuffer,
//       to_formats: ["md"],
//     });

//     expect(result.document.md_content).toBeDefined();

//     // Upload content directly
//     const upload = new Upload({
//       client: s3Client,
//       params: {
//         Bucket: testBucket,
//         Key: testKey,
//         Body: result.document.md_content,
//         ContentType: "text/markdown",
//       },
//     });

//     const uploadResult = await upload.done();

//     expect(uploadResult.ETag).toBeDefined();

//     // Verify content type
//     const headResult = await s3Client.send(
//       new HeadObjectCommand({
//         Bucket: testBucket,
//         Key: testKey,
//       })
//     );

//     expect(headResult.ContentType).toBe("text/markdown");
//   }, 60000);

//   it("should demonstrate error handling", async () => {
//     // Test with invalid bucket name to trigger error
//     const invalidBucket = "invalid-bucket-name-that-does-not-exist-12345";

//     const pdfBuffer = Buffer.from("%PDF-1.4\ntest content");

//     const sourceStream = await docling.getConversionStream(
//       pdfBuffer,
//       "test.pdf",
//       { to_formats: ["md"] },
//       true
//     );

//     const upload = new Upload({
//       client: s3Client,
//       params: {
//         Bucket: invalidBucket,
//         Key: "test/error-handling.zip",
//         Body: sourceStream,
//         ContentType: "application/zip",
//       },
//     });

//     // Should throw error for invalid bucket
//     await expect(upload.done()).rejects.toThrow();
//   }, 30000);
// });
