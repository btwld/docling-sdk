# S3 Integration

[Home](../README.md) > [Docs](./README.md) > S3 Integration

The API client sends S3 source/target requests to Docling Serve, which performs
storage access. Credentials and storage locations travel to that server, which
must be able to reach the configured endpoint. The SDK does not use an AWS SDK
credential-provider chain.

## S3Config

`S3Config` maps SDK convenience fields to the server request format:

```typescript
interface S3Config {
  bucket: string;            // S3 bucket name
  key?: string;              // File key (source) or key prefix (target)
  region?: string;           // AWS region (default: "us-east-1")
  endpoint?: string;         // Custom endpoint (default: s3.<region>.amazonaws.com)
  access_key_id?: string;    // Falls back to AWS_ACCESS_KEY_ID env var
  secret_access_key?: string; // Falls back to AWS_SECRET_ACCESS_KEY env var
  verify_ssl?: boolean;      // Default: true
}
```

`session_token` exists in the SDK config type but is not forwarded by the current
adapters. Use credentials supported by the server request fields. For the shared
contract rationale, see [SDK contract and server adapters](../ARCHITECTURE.md#sdk-contract-and-server-adapters).

## Converting from S3

```typescript
const result = await client.convertFromS3(
  {
    bucket: "my-documents",
    key: "reports/annual-report.pdf",
    region: "us-east-1",
  },
  {
    to_formats: ["md"],
    do_picture_description: true,
  }
);

console.log(result.document.md_content);
```

The SDK:

1. Maps `S3Config` to the OpenAPI `S3Source` format
2. Resolves credentials from the config or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` environment variables
3. Sends the source request to Docling Serve, which reads the file from S3

## Uploading to S3

Use `convertWithTarget` with an S3 target:

```typescript
const result = await client.convertWithTarget(
  [{ kind: "http", url: "https://example.com/doc.pdf" }],
  {
    kind: "s3",
    endpoint: "s3.us-east-1.amazonaws.com",
    bucket: "output-bucket",
    key_prefix: "converted/",
    access_key: "AKIAIOSFODNN7EXAMPLE",
    secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  },
  { to_formats: ["md", "json"] }
);
```

The target uses the raw OpenAPI `S3Target` format directly.

## Source-Based S3 Operations

Include S3 sources alongside other source types:

```typescript
const result = await client.convertSource({
  sources: [
    {
      kind: "s3",
      endpoint: "s3.us-east-1.amazonaws.com",
      bucket: "my-bucket",
      key_prefix: "documents/report.pdf",
      access_key: "AKIAIOSFODNN7EXAMPLE",
      secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
  ],
  options: { to_formats: ["md"] },
});
```

## Type Adapters

Adapters map fields such as `key` to `key_prefix` and `access_key_id` to
`access_key`:

```typescript
import { toOpenApiS3Source, toOpenApiS3Target } from "docling-sdk";

// S3Config -> S3Source
const source = toOpenApiS3Source({
  bucket: "my-bucket",
  key: "documents/file.pdf",
  region: "us-west-2",
  access_key_id: "AKIAIOSFODNN7EXAMPLE",
  secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
});
// Returns: { kind: "s3", endpoint: "s3.us-west-2.amazonaws.com", bucket, key_prefix, ... }

// S3Config -> S3Target
const target = toOpenApiS3Target({
  bucket: "output-bucket",
  key: "converted/",
  region: "us-west-2",
});
// Returns: { kind: "s3", endpoint: "s3.us-west-2.amazonaws.com", bucket, key_prefix, ... }
```

### isUserFriendlyS3Config

Detect whether an S3 config uses user-friendly field names:

```typescript
import { isUserFriendlyS3Config } from "docling-sdk";

isUserFriendlyS3Config({ kind: "s3", region: "us-east-1", bucket: "b" });
// true -- has "region" instead of "endpoint"

isUserFriendlyS3Config({ kind: "s3", endpoint: "s3.amazonaws.com", bucket: "b" });
// false -- raw OpenAPI format
```

## Environment Variables

Credentials fall back to environment variables when not provided in the config:

| Variable | Description |
|----------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key ID |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key |
| `AWS_REGION` | AWS region (used by adapters) |

This works across Node.js, Bun, and Deno (with `--allow-env`).

## Custom Endpoints

For S3-compatible services like MinIO or LocalStack, set the `endpoint` field:

```typescript
// MinIO
const result = await client.convertFromS3({
  bucket: "documents",
  key: "file.pdf",
  endpoint: "http://localhost:9000",
  access_key_id: "minioadmin",
  secret_access_key: "minioadmin",
  verify_ssl: false,
});

// LocalStack
const result = await client.convertFromS3({
  bucket: "documents",
  key: "file.pdf",
  endpoint: "http://localhost:4566",
  access_key_id: "test",
  secret_access_key: "test",
  verify_ssl: false,
});
```

## Related

- [API Client](./api-client.md) -- conversion methods with source and target
- [Configuration](./configuration.md) -- S3Config type reference
- [API Reference](./api-reference.md) -- method signatures
