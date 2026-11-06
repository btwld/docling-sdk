# Native document conversion: design and reference review

Status: native design proposed. Source review supplied by Leo on 2026-10-28,
reproduced in the cloud workspace on 2026-10-29. Correctness implementation
started on 2026-11-03; see the implementation record below for validation and
remaining gates. This document does not authorize publication or changing the
Python default.

**Latest delivery record:** [SDK hardening and validation, 2026-11-06](review-evidence/native-conversion/release-hardening-2026-11-06.md).
The baseline and earlier implementation records below are historical: later work
does include isolated Python/models, real Serve and packed-consumer validation.
The native backend remains proposed; this record does not assert a release or merge.

## Recommendation

Correct the existing local conversion contract before treating it as a reference
implementation. Add an explicit Rust backend afterward, preserving the current
API, browser clients, root factory behavior and public imports.

Use a pinned `docling-rs` executable as a child process for the first native
backend. This matches Wayfinder's proposed capture runner and permits a private
job directory, a controlled child environment and process termination per
conversion. Share upstream runtime/model identities and conversion fixtures;
Wayfinder remains a Dart consumer without a dependency on this TypeScript SDK.

Upstream Node bindings are a real alternative. On 2026-10-29, published
`docling.rs@2.53.1` metadata listed macOS ARM64, Linux x64/ARM64/s390x and Windows
x64 packages; the registry's current version was 2.53.3. The inspected source
remains tag v2.53.1, commit
`f6012c104ab395e97415b0b078e7aee9e4df4bf1`. Its source package version 0.6.1 is
pre-release stamping, not the published package version. Version 2.53.3 has not
received equivalent source/behavior review here and must not silently replace a
reviewed pin.

Choose the executable initially because a native Promise API alone does not
establish hard cancellation or crash isolation. The inspected Node dependency
resolver mutates process-wide environment variables. Its readiness status checks
the layout model and ONNX runtime availability where required, without requiring
complete OCR/table coverage; its ML assertion has a separate layout check and a
remote-VLM exception. A subprocess around N-API would recreate a process protocol
already supplied by the executable. Reconsider upstream N-API only if measured
model startup is the limiting cost for a demonstrated long-lived Node consumer.
Do not invent a custom native ABI or ship both mechanisms before that need exists.

## Scope and baseline evidence

- Original SDK baseline: `5ae3517a57d3a803845f1c7d10aa6749c309a4e0`, main,
  package version 2.0.7. The cloud branch is
  `conductor/docling-sdk-native-backend`.
- On 2026-11-03 the branch was fast-forwarded to
  `cd5830477be311c52497df65f32478f040c1eb0f`, the merged documentation-only
  [PR #87](https://github.com/btwld/docling-sdk/pull/87). The baseline product
  defects were not fixed by that PR.
- Inspected factory, local/process paths, API forwarding, HTTP options, task
  completion, browser conversion, public types, build, exports and CI/release
  workflows. Source inspection is distinct from runtime validation.
- Cloud Linux x64, Node 24.22.1, Vitest 2.1.9: the original typecheck, lint,
  build and 154 unit tests across 14 files passed. The supplied review's Node
  26.4.0 observations were not this cloud environment's results.
- Seven focused probes reproduced R1–R6 using synthetic input, harmless filename
  expansion, stub executables, local task events and a loopback HTTP fixture.
  A passing historical probe means a defect was reproduced, not fixed.
- A clean `git archive HEAD` baseline measured 23.17% aggregate line coverage,
  including examples/scripts, and 13.45% for the main CLI client. This supersedes
  the supplied environment's 23.36% aggregate observation. An initial workspace
  run measured 22.86% because the broad configuration also collected an ignored
  upstream research file; that number is not the clean baseline.
- Restricting the historical coverage data to production source files gives
  28.27% lines/statements, 57.85% branches and 27.63% functions. This is a
  different denominator, not a measured quality improvement.
- No Python/Rust document conversion, converter/model installation, real OCR,
  browser engine, other operating system, live Docling server or installed packed
  consumer was validated. CI uses Node 20 and the package declares Node >=18;
  Node 24 results do not establish that runtime matrix.
- No release, push, PR creation, merge, permission change or backend switch was
  performed by this review/fix workspace.

The original untracked probes and their local evidence were preserved before the
fix pass. Scripts are [runtime probes](review-evidence/native-conversion/probes.ts)
and [coverage proof](review-evidence/native-conversion/coverage-gate.mjs).
Raw results, fixtures and historical logs remain in the ignored
`.context/native-review/`; current orchestration and verification records are in
`.context/correctness-pass/`. Do not run the historical defect assertions as a
correctness suite after fixes.

## Findings and intended repairs

### R1 — filenames are interpreted by a shell (P1)

The original [CLI client](../src/clients/cli-client.ts) constructed a command
string, split/rejoined arguments and called `exec`. A public conversion of a
literal `$(printf DOCLING_REVIEW_LITERAL).pdf` filename delivered
`DOCLING_REVIEW_LITERAL.pdf` to a stub. No destructive command was used.

Use an executable plus argument array with `shell: false` throughout local
conversion and discovery. Python module invocation is an executable plus prefix
arguments, never a command string. Retain compatibility adapters where a public
surface requires them, without using shell escaping as an execution boundary.

Regression coverage must exercise public conversions, paths and executable names
containing spaces, quotes, substitutions and Unicode, plus explicit Python-module
fallback. Assert exact arguments received by a harmless stub and no substitution.

### R2 — failed, empty and partial conversions report success (P1)

The original per-file aggregation counted failed formats but unconditionally
emitted completion and returned success. Probes reproduced success for a sole
format exiting 7, a zero-exit converter writing nothing, and Markdown success
combined with JSON failure.

Derive status from every requested output and upstream conversion status.
All failed means failure; mixed outcomes remain partial. Validate output ownership,
existence and format completeness rather than relying on exit zero. Do not infer
complete pages from successful process termination or reject legitimate empty
documents without reference to the upstream format contract. Result, warnings
and progress events must describe the same outcome.

Tests must cover all-success/all-failure/mixed outputs, missing files, malformed
JSON, valid empty documents, upstream partial status and completion events.

### R3 — a conversion can return another document's output (P1)

The parser searched generic fallback filenames in a shared output directory.
A successful stub writing nothing for `new-document.pdf` returned a pre-existing
synthetic `output.md` belonging to another document. Same-basename concurrent
requests also shared an output namespace and per-client progress state.

Use a private directory and closed expected-file inventory per job. Separate
progress, input cleanup and output ownership from reusable client configuration.
Never recover results by searching unrelated files. Preserve legitimate
file-output APIs while validating destination ownership, collisions and paths.

Tests must prepopulate unrelated outputs, overlap same-basename conversions and
formats, and check cleanup, caller-owned files, traversal and symlink escapes.

### R4 — concurrent tasks lose completion events (P1)

The original [task manager](../src/services/async-task-manager.ts) installed
global `once` listeners, then filtered by task ID inside each callback.
[CrossEventEmitter.once](../src/platform/events.ts) removed the listener before
the filter. A success event for A consumed B's success listener; A resolved while
B remained pending after its own success. Failure/timeout/error listeners leaked.

Keep one terminal promise/state per task or persistent filtered listeners with
explicit cleanup. Settle multiple/late waiters, cancellation and destruction;
bound terminal-state retention. Late in-flight polling callbacks must not
resurrect deleted tasks or timers. Do not alter generic emitter-once semantics.

Tests must cover both completion orders, repeated and mixed terminal events,
multiple/late waiters, unknown tasks, cancellation, destruction and in-flight
poll cleanup, asserting exactly-once settlement and no leaked timers/listeners.
The exported ZIP file service must register each uploaded task before waiting;
exercise both `FileService` and `client.files` with the real manager so a mocked
completion result cannot hide a missing registration.

### R5 — readiness and process termination can be false positives (P2)

The original initialization ignored false availability and emitted ready for
missing executables. [CliUtils](../src/cli/utils.ts) also coerced a signal exit's
null code to zero. A child killing itself with SIGTERM reported success; a control
recorded null exit code and SIGTERM. Sending a signal is not proof of termination:
`child.killed` must not suppress necessary escalation.

Require readiness success. Use a single process lifecycle implementation with
separate exit code/signal, bounded output, typed timeout/abort outcomes, descendant
termination and escalation. Settle after termination and cleanup. Keep ordinary
converter failure, missing executable, timeout and cancellation distinct.

Tests must exercise nonexistent executables, failed version checks, nonzero and
signal exits, timeouts/aborts, signal-resistant children, descendants, output
limits and cleanup. Parent SIGINT/SIGTERM must propagate past the format boundary
and stop dispatching later formats/sources, even after an earlier format succeeds;
the interrupted job must not resolve as a partial conversion. Linux tests cannot
establish Windows/macOS guarantees.

### R6 — callers cannot disable configured HTTP retries (P2)

The [HTTP wrapper](../src/api/http.ts) used `retries || 3`; the public API
constructor dropped zero through truthiness, and configuration updates could
skip rebuilding the transport. A zero-retry public client made four loopback
503 requests. Updating from one retry to zero still made two requests.

Preserve explicit zero through construction, configuration updates and request
overrides using nullish defaults/property-presence checks. Retain current default
retry behavior and HTTP/browser imports. Do not transplant broad error-string
retry heuristics into a future native backend.

Public-boundary tests must assert actual attempt counts for zero, positive/default
configuration and updates; per-request overrides must take precedence for ordinary
and streamed responses, including a positive override on a zero-default client.
Transport rebuilds must preserve API-key authentication and explicit custom-header
precedence. Test received headers and actual attempts through public callers.

### R7 — the advertised coverage gate does not enforce its target (P2)

The original [Vitest configuration](../vitest.config.ts) nested thresholds under
`global`, which installed Vitest 2.1.9 interpreted as a filename pattern. The
coverage command exited zero well below 80%; CI ran ordinary unit tests.
A disposable fixture at 40% line/50% function coverage passed the nested gate
and exited 1 with correctly placed thresholds.

Use direct global `lines`, `branches`, `functions` and `statements` thresholds,
explicit production-source inclusion and CI coverage execution. Test actual
process exit behavior against low/full-coverage disposable sources using the
repository configuration. Keep the 80% target visible; correcting configuration
does not eliminate the existing coverage deficit. Do not lower expectations or
exclude untested production paths simply to turn the gate green.

## Dependency and compatibility review

The 2026-11-03 production audit still reports six high-severity affected package
entries: brace-expansion, glob, lodash, minimatch, ws and zod. Exploitability of
every advisory through this SDK is not established. The current advisories have
changed since October 29, so old audit counts and candidate versions do not prove
a candidate lockfile is safe. For example, the newer glob cancellation advisory
affects versions through 14.0.1, and minimatch includes an amplification advisory
below 11.0.1; blindly refreshing within old transitive ranges is insufficient.

The October 29 PR inspection found only dependency/Actions updates. PR #83
targets ws 8.21.3; PR #85 locks Zod 4.6.5, below the observed 4.6.6 advisory fix
boundary, despite passing checks. PR #84 updates only the coverage plugin major
and requires coordinated review with Vitest itself. These are historical PR-head
observations, not authorization to merge or a statement about their current CI.
Review specific advisories, dependency paths, Node compatibility and candidate
lockfile audit results before changing production dependencies.

Documentation cleanup landed separately in PR #87. It accurately narrows the
browser's Office/HTML claims, discloses placeholder generated endpoint types and
records ESM packaging. Actual generated Serve endpoint types still require a
pinned supported schema and compilation of the documented example; do not
hand-edit generated placeholders or present them as completed endpoint coverage.

The deprecated ConnectionPool implementation remains alongside ofetch. Verify
public imports before removing it; a native client does not need another pool.
Consolidate duplicate process runners while retaining required public adapters.
Replace repetitive comments with useful constraints where needed. Patterns such
as "NestJS service pattern" do not establish correctness or AI authorship;
demonstrated behavior and responsibility are the review criteria.

## Proposed smallest native contract

Add an isolated `docling-sdk/native` entry point for local PDF, DOCX and PPTX to
Markdown and structured JSON with referenced assets. Do not implement the broad
server/browser/S3/watcher/archive/ASR interface merely to fit an existing type.

Illustrative API, not an implemented export:

```ts
import { createNativeClient } from "docling-sdk/native";

const client = createNativeClient({
  executable: installedRuntime.executable,
  modelDirectory: installedRuntime.modelDirectory,
  manifest: installedRuntime.manifest,
});

const result = await client.convertFile("./report.pdf", {
  outputDirectory: "./converted",
  formats: ["md", "json"],
  signal: abortController.signal,
});
```

Verify the supported runtime and required asset inventory before conversion.
Never download, mutate global environment, switch to Python or remote VLM, or
return another document silently. Any installer is a separate explicit operation
using pinned digests, safe extraction, platform checks and license notices.
Do not pipe an upstream installer into a shell or compile Rust on the user's
machine as an implicit setup step.

Snapshot input, validate bounded options, use private staging, launch the engine,
validate all outputs and publish into a new job directory beneath the caller's
destination. Abort/timeout must terminate the process tree and clean incomplete
staging. Reject traversal, symlink escapes and collisions. Block URL inputs and
external resource fetching in this local-only mode; verify no egress through
effective isolation, not a flag alone. Converter diagnostics and documents are
data, not instructions.

Return success/partial_success/failure, job-owned files, requested/completed page
coverage where upstream supplies it, warnings and runtime identity. Invalid
configuration/input, cancellation, timeout and execution failure reject rather
than becoming success. Preserve upstream JSON and validate its runtime shape;
do not invent missing fields or substitute casts for validation. Wayfinder's
proposed publication gate rejects incomplete captures.

The SDK owns conversion, not Knowledge placement, OKF fields, source retirement,
indexing or a full capture receipt. Wayfinder combines outputs with original-file
hashes, provenance and its guarded bundle transaction. Neither repository needs a
dependency on the other or a new general plugin system.

## Ordered implementation and release gates

1. Preserve this review and historical evidence; establish public regressions and
   truthful production coverage measurement.
2. Correct executable/argv safety and readiness/process lifecycle (R1/R5), then
   per-job ownership (R3) and truthful format/result status (R2).
3. Correct task lifecycle (R4) and retry configuration (R6). Enforce the coverage
   gate (R7), report the existing deficit, and review dependencies separately.
4. Prove an exact executable/model set against synthetic/licensed PDF, scanned
   PDF, DOCX and PPTX. Check tables, page coverage, speaker notes, images, partial
   failures, offline behavior, cancellation and actual model requirements.
   Compare Python only for behavior existing callers need; make no parity or
   performance claim before evidence.
5. Add the narrow native entry point with one runner, private staging, bounded
   results and no native assets entering HTTP/browser imports. Test missing and
   corrupt runtime/assets, unsupported platforms and concurrency.
6. Install packed npm artifacts into clean projects on each supported OS and
   declared Node baseline. Test optional-dependency omission, browser bundling,
   real startup, interrupted setup and wrong digests. CI must exercise these
   paths before publication.
7. Adopt explicitly with supported options and migration examples. Existing
   Python users remain unchanged. Changing the established default or removing
   public APIs requires a deliberate major release and supported migration.

Native blockers remain an approved executable/model manifest with digests and
license inventory, real fixture evidence, tested process-tree termination and
network isolation per platform, and packed-consumer validation. No native
backend, profile release or converter/model installation has occurred here.

Synchronize README capabilities, getting-started, configuration, CLI/API
reference, error handling, TypeScript, cross-runtime, migration and executable
examples when their actual behavior changes. Keep architecture boundaries in one
place and distinguish proposals from available functionality.

## Implementation record

2026-11-03: the R1–R7 correctness implementation is local and uncommitted on
`conductor/docling-sdk-native-backend`, based on
`cd5830477be311c52497df65f32478f040c1eb0f`. Native conversion remains proposed.
Workers used `gpt-6.1-sol`, high reasoning and requested fast service tier through
Conductor's existing proxy. Three implementation workers and four focused
follow-up workers completed their assignments; independent source review remains
separate from runtime verification. No converter/models were installed and no
commit, push, PR write, publication or backend switch occurred.

| Finding | Local implementation and regression coverage |
| --- | --- |
| R1 | One shell-free executable/argv runner across CLI paths; literal path and Python-module fallback regressions. |
| R2 | Validate every expected format and preserve failure/partial status; nonzero exit, missing/malformed output, empty-document and mixed-output regressions. |
| R3 | Private job/input/format directories and a closed output inventory; stale-output, concurrent same-basename, path/symlink and cleanup regressions. |
| R4 | Per-task completion promises, bounded terminal retention and timer cleanup; concurrent/multiple/late waiters and real-manager ZIP service regressions. |
| R5 | Truthful readiness/exit/signal handling, bounded capture and process-group termination; parent SIGINT/SIGTERM propagates after cleanup and prevents later formats, sources and queued batch chunks. |
| R6 | Explicit zero preserved across constructors, updates and ordinary/stream overrides; real loopback headers, attempt counts and retry delays verified. |
| R7 | Direct 80% thresholds for all production source; CI/release/prepublish invoke coverage. Disposable low/full-coverage fixtures prove gate failure/success. The repository-wide gate still fails. |

Source review found four additional integration gaps during the pass: retry
updates omitted API-key authentication, streaming adapters dropped request retry
overrides, the exported ZIP service awaited unregistered tasks, and format error
aggregation swallowed parent cancellation. Focused follow-ups fixed all four and
added public caller regressions; ordinary format failures still aggregate partial
results. Final source review found a fifth integration gap: the public batch
caller still swallowed the abort. Both batch branches and the directory wrapper
now preserve it, and parallel batch waits for every started sibling to settle
before rejecting. Isolated signal regressions confirm queued-work suppression,
cleanup at settlement and preservation of earlier completed jobs. The primary
reviewed that final correction against the retained source-review finding.

Central validation on 2026-11-03, Linux x64 / Node **20.20.2** (superseded by
the [2026-11-06 review](review-evidence/native-conversion/fresh-review-2026-11-06.md)):

- Typecheck (`--incremental false`), lint and build passed.
- **361 unit tests across 21 files passed**, executed by `npm run test:coverage`.
- Production coverage at that point was **45.68% lines/statements, 68.93% branches,
  45.45% functions**; the main CLI client has **65.84% line coverage**.
- The coverage command correctly exited **1** because every global metric is below
  the unchanged **80%** target. CI, release validation and prepublish are therefore
  blocked; passing unit assertions do not make those gates green.

Production coverage measures all `src/**/*.ts` except declarations, including
unexercised paths. Historical production-only line coverage was 28.27%; the
implementation also removes duplicated source, so the current percentage is not
an isolated measurement of added tests. Machine-readable observations for that pass are
[retained with the evidence](review-evidence/native-conversion/correctness-observations.json).
Detailed logs and the full coverage summary remain in
`.context/correctness-pass/final-node20-*`; original defect probes remain unchanged.

Compatibility changes requiring review: successful CLI artifacts now belong to a
private job directory, JSON content is validated/parsed, diagnostic-string retries
are removed, missing readiness rejects, unknown task waits fail immediately, and
parent cancellation rejects rather than becoming a partial success. Public imports,
the root factory, Python selection, HTTP and browser execution modes remain.
`convertMultipleFiles()` retains eager dispatch and per-file failure results
for cancellation. On 2026-11-03, source inspection identified that a throwing
progress callback could reject its aggregate while siblings continued. The
2026-11-06 pass reproduced and fixed that limitation: rejection now waits for
started siblings to settle.
Windows process-tree termination is best effort; Linux tests do not prove other
platforms, Node 18, real document conversion/OCR or packed-consumer compatibility.

### Fresh review and cleanup — 2026-11-06

The [fresh review record](review-evidence/native-conversion/fresh-review-2026-11-06.md)
documents nine corrected findings, their provenance and public regressions. The
pass fixes destination-stream lifecycle, cleanup through symlinked temporary
roots and throwing listeners, multi-file callback lifetime, batch output and
concurrency options, API-key-only updates, standalone chunk-service destruction,
and split-page HTML compatibility. It also consolidates batch/transport setup and
removes redundant runner wrappers. Original probes and dated results are retained.

Latest Linux x64 / Node **20.20.2** validation: **383 tests in 21 files pass**;
typecheck, lint and build pass. Production coverage is **46.26% lines/statements,
69.39% branches and 46.04% functions**; the main CLI client is **69.97% lines**.
The unchanged 80% gate correctly exits **1**, so CI/release/prepublish remain
blocked. No dependency audit was rerun during this fresh pass; dependencies and
lockfile are unchanged. No converter/models, native backend or real-engine parity
were validated. Changes remain local and uncommitted.

Remaining work, in order:

1. Review the local correctness diff and its visible compatibility changes. The
   recorded integration findings and fresh-review findings have corrections and
   regression evidence, including the previously deferred callback limitation.
2. Add behavior coverage for uncovered production paths until all four metrics
   reach 80%; keep the corrected gate and denominator intact. Recheck and remediate
   the six dependency entries from the earlier audit with Node compatibility and
   candidate audits; the old count is not a fresh security assessment.
3. Validate the existing Python converter and packed HTTP/browser/CLI consumers
   on the declared Node/OS matrix before treating the correctness pass as release
   ready. No release is authorized here.
4. Approve a pinned native executable/model manifest and verify real licensed
   fixtures, page/asset completeness, offline isolation and cancellation.
5. Implement the additive narrow native entry point, then verify packed consumers
   and adopt it explicitly. Do not silently switch Python or add a Dart/TypeScript
   repository dependency.

## Upstream references inspected

- [Node bindings and platform design](https://github.com/docling-project/docling.rs/blob/v2.53.1/crates/docling-node/README.md)
- [Dependency resolution and environment mutation](https://github.com/docling-project/docling.rs/blob/v2.53.1/crates/docling-node/deps.js)
- [Node public API](https://github.com/docling-project/docling.rs/blob/v2.53.1/crates/docling-node/index.d.ts)
- [Executable conversion options](https://github.com/docling-project/docling.rs/blob/v2.53.1/docs/OPTIONS.md)
- Published metadata rechecked on 2026-10-29 with
  `npm view docling.rs@2.53.1 version optionalDependencies engines --json` and
  `npm view docling.rs version optionalDependencies engines --json`.
