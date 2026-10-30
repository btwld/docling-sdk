# Architecture decisions

Short records of the SDK's execution and compatibility boundaries. Existing
choices were reconstructed on 2026-10-30; implementation dates are not
retroactive approvals. Inferred rationale is identified below. Keep specifications,
contracts, runbooks and usage in their [guides](docs/README.md); record consequential
replacements here and mark the old section superseded. Each entry has a title,
date and 1–3 sentences covering the decision, reason and cost; ordinary fixes and
test-tool defaults need no entry.

## Client execution modes

Date: 2026-10-30 · Observed active · Reconstructed; implemented by 2026-02-09

API, CLI and Web clients share conversion interfaces while selecting server,
local Python or browser execution. This keeps client selection explicit but does
not promise feature parity: Web file-output methods reject as unsupported.

Evidence: [factory](src/docling.ts), [client contracts](src/types/client.ts),
[Web client](src/clients/web-client.ts), [PR #60](https://github.com/btwld/docling-sdk/pull/60).

## Runtime boundaries

Date: 2026-02-09 · Observed active · Rationale reconstructed 2026-10-30

Use `Uint8Array`, fetch-based transport and a browser entry excluding the Node CLI
to support API conversion outside Node. This requires runtime-specific exports
and explicit limits for filesystem and Node-stream methods.

Evidence: [browser entry](src/browser-entry.ts), [HTTP wrapper](src/api/http.ts),
[runtime guide](docs/cross-runtime.md); supersedes [custom Node transport](#custom-node-transport-superseded).

## ESM-only packaging

Date: 2026-02-11 UTC · Observed active · Implemented in v2.0.4

Publish ESM with shared chunks and separate type declarations to reduce package
size, as recorded in PR #67. Consumers must migrate from `require()` to ESM
imports; the PR's size measurements cover the combined packaging changes.

Evidence: [build](tsup.config.ts), [exports](package.json),
[PR #67](https://github.com/btwld/docling-sdk/pull/67); supersedes [dual module output](#dual-module-output-superseded).

## SDK contract and server adapters

Date: 2026-02-09 · Observed active · Rationale reconstructed 2026-10-30

Keep handwritten SDK types as the public contract and translate convenience
configuration at the server boundary to decouple callers from the upstream
schema. This costs synchronization across types, validators and adapters; the
exported OpenAPI namespace still contains placeholders. S3 follows this boundary,
with storage access delegated to the server and field limits documented in the
[S3 guide](docs/s3-integration.md).

Evidence: [SDK types](src/types/api.ts), [placeholder](src/types/generated/api.ts),
[S3 adapters](src/types/adapters/s3.ts), [type workflow](docs/typescript.md).

## Conversion and error contracts

Date: 2026-10-30 · Observed active · Reconstructed; direct returns by v1.3.1

Ordinary conversion returns a document response; `safeConvert` wraps rejected
operations for callers preferring Results. File-output methods have a separate
success/failure object, so a safe wrapper can succeed around an inner failure;
Web file-output methods reject as unsupported.

Evidence: [PR #35](https://github.com/btwld/docling-sdk/pull/35),
[error contracts](docs/error-handling.md#result-pattern).

## Async lifecycle and fallback

Date: 2026-10-30 · Observed active · Reconstructed

Track server task completion separately from progress delivery so completion
does not depend on WebSocket updates; hybrid progress falls back to HTTP on
WebSocket errors or an initial timeout without progress.
Separate service managers and progress trackers own polling/timers; API
`client.destroy()` clears the file manager, while the chunk manager needs explicit
`client.chunks.getTaskManager().destroy()` because `ChunkService.destroy()` is empty.
Caller-owned progress trackers need `stopTracking()`, and application webhook
delivery belongs to the caller.

Evidence: [task manager](src/services/async-task-manager.ts),
[progress tracker](src/services/progress-tracker.ts), [usage](docs/async-progress.md).

## Browser inference worker

Date: 2026-02-09 · Observed active · Rationale reconstructed 2026-10-30; packaging clarified by #65–66

Run Granite inference in a module worker to keep conversion local to the browser
and off the UI thread. Users must download/cache model assets and manage worker
setup/lifecycle; bundlers must retain initialization side effects, and PDF
rendering adds the optional `unpdf` dependency.

Evidence: [worker](src/web/worker.ts), [Cache API storage](src/web/cache.ts),
[PR #65](https://github.com/btwld/docling-sdk/pull/65), [PR #66](https://github.com/btwld/docling-sdk/pull/66).

## Transfer semantics

Date: 2026-10-30 · Observed active · Reconstructed

Expose byte and stream methods for different destinations and runtime needs.
Some paths buffer multipart input or complete responses, while async download
streams lack a portable byte fallback, so choose by the documented method
behavior rather than a stream-shaped return value.

Evidence: [transfer table](docs/streaming.md#method-behavior),
[platform multipart encoder](src/platform/http.ts), [file service](src/services/file.ts).

## Workflow-owned versions

Date: 2025-08-21 · Observed active · Automatic bumps; workflow introduced 2025-08-13

Use the GitHub Actions release workflow instead of semantic-release so version
selection stays with automation, with a manual override for maintainers. The
workflow pushes intermediate state, so failed releases require inspecting
repository and registry state before retrying rather than manually bumping
versions again.

Evidence: [PR #16](https://github.com/btwld/docling-sdk/pull/16),
[PR #23](https://github.com/btwld/docling-sdk/pull/23), [release runbook](CONTRIBUTING.md#releases).

## Dual module output (superseded)

Date: 2026-02-11 UTC · Superseded by [ESM-only packaging](#esm-only-packaging)

Earlier builds published CJS and ESM for module-system compatibility, at the
cost of additional build output. [PR #67](https://github.com/btwld/docling-sdk/pull/67)
replaced that choice with ESM-only packaging to reduce package size, dropping CJS
compatibility.

## Custom Node transport (superseded)

Date: 2026-02-09 · Superseded by [runtime boundaries](#runtime-boundaries)

The earlier custom Node connection pool managed socket reuse but tied transport
to Node. [PR #60](https://github.com/btwld/docling-sdk/pull/60) replaced it with
fetch-based transport for portability, retiring the pool's configuration API;
the [retained source](src/api/index.ts) is deprecated.
