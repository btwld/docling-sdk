# Architecture decisions

Short records of the SDK's execution and compatibility boundaries. Existing
choices were reconstructed on 2026-10-30; implementation dates are not
retroactive approvals. Inferred rationale is identified below. Keep current usage
in the [guides](docs/README.md); record consequential replacements here and mark
the old section superseded. Ordinary fixes and test-tool defaults need no entry.

## Client execution modes

*Observed active; implemented by 2026-02-09; rationale reconstructed.*

API, CLI and Web clients share conversion interfaces while selecting server,
local Python or browser execution. This keeps client selection explicit but does
not promise feature parity: Web file-output methods reject as unsupported.

Evidence: [factory](src/docling.ts), [client contracts](src/types/client.ts),
[Web client](src/clients/web-client.ts), [PR #60](https://github.com/btwld/docling-sdk/pull/60).

## Runtime boundaries

*Observed active; implemented 2026-02-09; rationale reconstructed.*

Use `Uint8Array`, fetch-based transport and a browser entry excluding the Node CLI
to support API conversion outside Node. This requires runtime-specific exports
and explicit limits for filesystem and Node-stream methods.

Evidence: [browser entry](src/browser-entry.ts), [HTTP wrapper](src/api/http.ts),
[runtime guide](docs/cross-runtime.md); supersedes [custom Node transport](#custom-node-transport-superseded).

## ESM-only packaging

*Observed active; implemented in v2.0.4, 2026-02-11 UTC.*

Publish ESM with shared chunks and separate type declarations to reduce package
size, as recorded in PR #67. Dropping CommonJS makes consumers migrate from
`require()` to ESM imports; the PR reports size measurements for the combined
packaging changes, not for removing CJS alone.

Evidence: [build](tsup.config.ts), [exports](package.json),
[PR #67](https://github.com/btwld/docling-sdk/pull/67); supersedes [dual module output](#dual-module-output-superseded).

## SDK contract and server adapters

*Observed active; scaffold added 2026-02-09; rationale reconstructed.*

Keep handwritten SDK types as the public contract and translate convenience
configuration at the server boundary rather than binding the SDK directly to a
generated upstream schema. This costs synchronization across types, validators
and adapters; the exported OpenAPI namespace still contains placeholders.

S3 is one example: adapters rename SDK fields and send credentials/location to
Docling Serve, which must reach storage. They do not use an AWS credential chain
or forward the config's `session_token`.

Evidence: [SDK types](src/types/api.ts), [placeholder](src/types/generated/api.ts),
[S3 adapters](src/types/adapters/s3.ts), [type workflow](docs/typescript.md).

## Conversion and error contracts

*Observed active; direct response introduced by v1.3.1; rationale reconstructed.*

Ordinary conversion returns a document response; `safeConvert` wraps rejected
operations for callers preferring Results. File-output methods have a separate
success/failure object, so a safe wrapper can succeed around an inner failure;
Web file-output methods reject as unsupported.

Evidence: [PR #35](https://github.com/btwld/docling-sdk/pull/35),
[error contracts](docs/error-handling.md#result-pattern).

## Async lifecycle and fallback

*Observed active; reconstructed 2026-10-30.*

Track server task completion separately from progress delivery, with hybrid
progress trying WebSocket and falling back to HTTP when startup fails or stalls.
Separate service managers and progress trackers own polling/timers and require
cleanup; application webhook delivery belongs to the caller.

Evidence: [task manager](src/services/async-task-manager.ts),
[progress tracker](src/services/progress-tracker.ts), [usage](docs/async-progress.md).

## Browser inference worker

*Observed active; implemented 2026-02-09; rationale reconstructed, packaging clarified by #65–66.*

Run Granite inference in a module worker to keep conversion local to the browser
and off the UI thread. Users must download/cache model assets and manage worker
setup/lifecycle; bundlers must retain initialization side effects, and PDF
rendering adds the optional `unpdf` dependency.

Evidence: [worker](src/web/worker.ts), [Cache API storage](src/web/cache.ts),
[PR #65](https://github.com/btwld/docling-sdk/pull/65), [PR #66](https://github.com/btwld/docling-sdk/pull/66).

## Transfer semantics

*Observed active; reconstructed 2026-10-30; constraints, not a constant-memory guarantee.*

Expose byte and stream methods for different destinations and runtime needs.
Some paths buffer multipart input or complete responses, while async download
streams lack a portable byte fallback, so choose by the documented method
behavior rather than a stream-shaped return value.

Evidence: [transfer table](docs/streaming.md#method-behavior),
[platform multipart encoder](src/platform/http.ts), [file service](src/services/file.ts).

## Workflow-owned versions

*Observed active; replacement introduced 2025-08-13, automatic bumps added 2025-08-21.*

Use the GitHub Actions release workflow instead of semantic-release, with the
workflow owning version selection and a manual override. The workflow pushes
intermediate state, so failed releases require inspecting repository and registry
state before retrying rather than manually bumping versions again.

Evidence: [PR #16](https://github.com/btwld/docling-sdk/pull/16),
[PR #23](https://github.com/btwld/docling-sdk/pull/23), [release runbook](CONTRIBUTING.md#releases).

## Dual module output (superseded)

*Superseded 2026-02-11 UTC by [ESM-only packaging](#esm-only-packaging).*

Earlier builds published CJS and ESM. That compatibility promise no longer
applies; see [PR #67](https://github.com/btwld/docling-sdk/pull/67).

## Custom Node transport (superseded)

*Superseded 2026-02-09 by [runtime boundaries](#runtime-boundaries).*

The old custom Node HTTP connection pool is no longer wired into API requests or
exported as an SDK configuration API. The retained source file does not describe
the active transport; see [deprecation](src/api/index.ts) and
[PR #60](https://github.com/btwld/docling-sdk/pull/60).
