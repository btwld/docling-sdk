# Async and Progress

[Home](../README.md) > [Docs](./README.md) > Async and Progress

The API client supports asynchronous document processing with task-based workflows, multiple progress tracking modes, and webhook integration.

## Sync vs Async

| Consideration | Sync | Async |
|--------------|------|-------|
| Response time | Blocks until complete | Returns task ID immediately |
| Large documents | May timeout | Handles any size |
| Progress tracking | Not available | WebSocket, HTTP polling, or hybrid |
| Batch processing | Sequential | Parallel with queue management |
| Result retrieval | Inline in response | Separate call (JSON or ZIP) |

Use async when:
- Documents are large or processing takes more than a few seconds
- You need progress updates
- You want to submit multiple documents and process them in parallel

## AsyncConversionTask

Created by `convertFileAsync`, `convertSourceAsync`, or `convertFileAsyncToZip`:

```typescript
const task = await client.convertFileAsync({
  files: buffer,
  filename: "document.pdf",
  to_formats: ["md"],
});

console.log(task.taskId);   // unique task identifier
console.log(task.status);   // "pending" | "started" | "success" | "failure"
console.log(task.position); // queue position
```

### Events

```typescript
task.on("progress", (status: TaskStatusResponse) => {
  console.log(status.task_status);
  console.log(status.task_position);
  console.log(status.task_meta);
});

task.on("complete", (result: ConvertDocumentResponse) => {
  console.log(result.document.md_content);
});

task.on("error", (error: ProcessingError) => {
  console.error(error.message);
});
```

### Waiting for completion

```typescript
const finalStatus = await task.waitForCompletion();
// finalStatus.task_status === "success"
```

### Manual polling

```typescript
const status = await task.poll();
// Check status.task_status and decide whether to poll again
```

## Getting Results

### JSON result (inbody target)

For tasks submitted with `target: { kind: "inbody" }`:

```typescript
const task = await client.convertSourceAsync({
  sources: [{ kind: "http", url: "https://example.com/doc.pdf" }],
  options: { to_formats: ["md"] },
  target: { kind: "inbody" },
});

await task.waitForCompletion();
const result = await client.getTaskResult(task.taskId);
console.log(result.document.md_content);
```

### ZIP result (default)

For tasks submitted with the default ZIP target:

```typescript
const task = await client.convertFileAsync({
  files: buffer,
  filename: "document.pdf",
  to_formats: ["md", "json"],
});

await task.waitForCompletion();
const zip = await client.getTaskResultFile(task.taskId);

if (zip.success && zip.fileStream) {
  zip.fileStream.pipe(createWriteStream("./result.zip"));
}
```

### Explicit ZIP target

```typescript
const task = await client.convertFileAsyncToZip({
  files: buffer,
  filename: "document.pdf",
  to_formats: ["md"],
});
```

## Polling

### pollTaskStatus

Long-polls the task status endpoint:

```typescript
const status = await client.pollTaskStatus(task.taskId, 100);
// waitSeconds controls the long-polling timeout (default from config)
```

Returns `TaskStatusResponse`:

```typescript
interface TaskStatusResponse {
  task_id: string;
  task_status: "pending" | "started" | "success" | "failure";
  task_position?: number;
  task_meta?: {
    total_documents?: number;
    processed_documents?: number;
    [key: string]: unknown;
  };
}
```

### Config-level polling settings

```typescript
const client = new Docling({
  api: { baseUrl: "http://localhost:5001" },
  waitSeconds: 100,     // Long-polling wait time (seconds)
  pollingRetries: 5,    // Max retries for polling failures
});
```

## Progress Tracking

The SDK supports three progress tracking modes, configured at the client or per-call level.

### HTTP polling

Periodically polls the task status endpoint:

```typescript
const client = new Docling({
  api: { baseUrl: "http://localhost:5001" },
  progress: {
    method: "http",
    httpPollInterval: 1000,  // poll every 1 second
    onProgress: (update) => {
      console.log(update.stage, update.percentage);
    },
  },
});
```

### WebSocket

Real-time updates through a persistent WebSocket connection:

```typescript
const client = new Docling({
  api: { baseUrl: "http://localhost:5001" },
  progress: {
    method: "websocket",
    websocketTimeout: 5000,
    onProgress: (update) => {
      console.log(update.stage, update.percentage);
    },
  },
});
```

### Hybrid (recommended)

Tries WebSocket first, falls back to HTTP polling:

```typescript
const client = new Docling({
  api: { baseUrl: "http://localhost:5001" },
  progress: {
    method: "hybrid",
    websocketTimeout: 5000,
    httpPollInterval: 1000,
    onProgress: (update) => {
      console.log(update.stage, update.percentage);
    },
    onComplete: (result) => {
      console.log("Processing complete");
    },
    onError: (error) => {
      console.error("Processing failed:", error.message);
    },
  },
});
```

### Per-call progress

Override the client-level progress config for a specific call:

```typescript
const result = await client.convert(buffer, "doc.pdf", { to_formats: ["md"] }, {
  method: "hybrid",
  onProgress: (update) => console.log(update),
});
```

## ProgressUpdate

```typescript
interface ProgressUpdate {
  stage: string;
  percentage?: number;
  message?: string;
  taskId?: string;
  position?: number;
  status?: string;
  timestamp: number;
  source?: "websocket" | "http";
  memoryUsage?: NodeJS.MemoryUsage;
  uploadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
}
```

## WebSocket Client

The `DoclingWebSocketClient` can be used directly for custom integrations:

```typescript
import { DoclingWebSocketClient } from "docling-sdk";

const ws = new DoclingWebSocketClient({
  baseUrl: "http://localhost:5001",
  timeout: 5000,
  reconnectAttempts: 3,
  reconnectDelay: 2000,
  heartbeatInterval: 30000,
});
```

### Events

| Event | Data | Description |
|-------|------|-------------|
| `connecting` | `string` | Connecting to server |
| `connected` | `string` | Connection established |
| `disconnected` | `{ code, reason }` | Connection closed |
| `error` | `Error` | Connection error |
| `taskUpdate` | `TaskStatusResponse` | Task status changed |
| `taskComplete` | `TaskStatusResponse` | Task completed |
| `taskFailed` | `TaskStatusResponse` | Task failed |
| `taskStarted` | `TaskStatusResponse` | Task started processing |
| `progress` | progress data | Progress update |
| `reconnecting` | `{ attempt, delay }` | Attempting reconnection |
| `reconnectFailed` | `{ attempt, error }` | Reconnection failed |

### Connection states

| State | Description |
|-------|-------------|
| `connecting` | WebSocket handshake in progress |
| `connected` | Connected and receiving updates |
| `disconnected` | Not connected |
| `error` | Connection error occurred |

## AsyncTaskManager

The `AsyncTaskManager` handles task submission, polling, and event emission:

```typescript
import { AsyncTaskManager } from "docling-sdk";

const taskManager = client.getTaskManager();

taskManager.on("status", ({ status, taskId }) => {
  console.log(`Task ${taskId}: ${status}`);
});

taskManager.on("success", ({ taskId }) => {
  console.log(`Task ${taskId} completed`);
});

taskManager.on("failure", ({ error, taskId }) => {
  console.error(`Task ${taskId} failed: ${error}`);
});

taskManager.on("timeout", ({ taskId }) => {
  console.warn(`Task ${taskId} timed out`);
});
```

### Task options

```typescript
interface TaskOptions {
  timeout?: number;       // Max wait time in ms
  pollInterval?: number;  // Polling interval in ms
  maxPolls?: number;      // Max poll attempts
  waitSeconds?: number;   // Long-polling wait (seconds)
  pollingRetries?: number; // Max retries for poll failures
}
```

## Webhook Integration

You can implement webhook notifications after task completion:

```typescript
const task = await client.convertFileAsync({
  files: buffer,
  filename: "document.pdf",
  to_formats: ["md"],
});

await task.waitForCompletion();

// Notify your webhook endpoint
await fetch(process.env.WEBHOOK_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    task_id: task.taskId,
    status: "success",
  }),
});
```

## Related

- [API Client](./api-client.md) -- async methods on the API client
- [Streaming](./streaming.md) -- streaming as an alternative to async
- [Chunking](./chunking.md) -- async chunking tasks
- [Configuration](./configuration.md) -- progress config options
