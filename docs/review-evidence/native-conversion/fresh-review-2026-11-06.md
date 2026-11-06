# Fresh correctness review and cleanup — 2026-11-06

**Status: reviewed and corrected locally; not release-ready.** Branch
`conductor/docling-sdk-native-backend`, unchanged HEAD
`cd5830477be311c52497df65f32478f040c1eb0f`. All implementation changes remain
uncommitted. No native backend, converter/model installation, commit, push, PR
write or publication was performed in this pass. Python remains the default
local backend; HTTP/browser entry points and package exports are unchanged.

## Scope and evidence

This pass reviewed the pending R1–R7 implementation and affected callers directly,
then applied Leo's requested correctness fixes and simplification. The
`review-agent` skill guided defect-first inspection; pre-existing gaps are not
presented as newly introduced regressions. No additional agents were started.

The starting tracked diff and copies of all modified/nonignored untracked files
are retained in `.context/fresh-review-2026-11-06/before.patch` and
`before-files.tar.gz`. Historical probes and dated observations remain intact.
New regressions use synthetic documents, a stub child process, local filesystem
state and loopback HTTP; they do not exercise a real document converter.

- `regressions-before.log`: 13 new cases failed against the starting working tree.
- `regressions-after.log`: 16 selected cases passed after the initial corrections.
- `split-html-before.log`: four split-page HTML cases failed before that fix.
- `coverage.log`: final full run, all **383 tests in 21 files passed**. The suite
  now has 22 more cases than the 2026-11-03 record.

The logs above live in `.context/fresh-review-2026-11-06/`. Not every added edge
case has a separate red-before log; the full final run is the common green
assertion record. The command still exits nonzero because of coverage, below.

## Confirmed findings and local corrections

All nine findings below are fixed locally. They include regressions in the
pending implementation and pre-existing public behavior gaps discovered while
checking it; the distinction is stated explicitly.

### F1 — [P2] Observe destination failure throughout conversion

- **Repro:** Destroy the destination while the stub converter is running; the
  starting implementation still launches another requested format. With missing
  output and an asynchronously failing destination finalizer, conversion resolves
  before the destination fails.
- **Root cause:** Destination observation began only when successful content was
  ready to write; the unsuccessful-result path did not await finalization. Early
  destination observation was also a weakness in the committed implementation,
  so this finding is not wholly attributed to the pending diff.
- **Fix:** Observe the writable side from entry, abort active conversion on
  destination error/premature finish, preserve the original destination error,
  await finalization for resolved failure results, and destroy/clean on rejection.
  The monitor can be cancelled independently when `emitClose` is disabled.
- **Tests:** Early close, early finish, delayed finalizer failure, suppressed close
  events, Duplex writable completion, no later formats, and private-job cleanup
  in [CLI regressions](../../../tests/unit/cli-conversion-correctness.test.ts).
- **Code:** [`convertToStream`](../../../src/clients/cli-client.ts).

### F2 — [P2] Clean the job before notifying a throwing error listener

- **Repro:** Convert a missing input with a `processing-error` listener that
  throws. The starting working tree leaves a `docling-job-*` directory behind.
- **Root cause:** Notification preceded cleanup in the job's error handler; a
  listener exception skipped cleanup. This is a confirmed gap in the pending
  job-lifecycle implementation, not evidence that every callback issue is new.
- **Fix:** Remove the private job before emitting the error event.
- **Test:** A public conversion rejects with the listener's error and has no
  leftover job directory at settlement.
- **Code/tests:** [`runDocumentJob`](../../../src/clients/cli-client.ts),
  [CLI regressions](../../../tests/unit/cli-conversion-correctness.test.ts).

### F3 — [P2] Canonicalize the temporary root before creating downloads

- **Repro:** Point the temporary root at a filesystem symlink and convert a
  synthetic downloaded input using stubbed fetch. The input directory remains
  after conversion.
- **Root cause:** The new cleanup guard rejects a noncanonical parent, but the
  download helper created directories beneath the noncanonical `tmpdir()` path.
  This is a regression introduced by the cleanup hardening.
- **Fix:** Resolve the temporary root, then use atomic `mkdtemp`; keep the cleanup
  guard against replaced ancestors. Remove the redundant UUID construction.
- **Test:** A symlinked temporary-root fixture verifies removal of the downloaded
  input. It runs on Linux and is skipped on Windows; it is not a macOS runtime
  validation, even though macOS commonly exposes temporary paths through aliases.
- **Code/tests:** [`createTempDirectory`](../../../src/clients/cli-client.ts),
  [CLI regressions](../../../tests/unit/cli-conversion-correctness.test.ts).

### F4 — [P2] Await siblings before rejecting a multi-file callback

- **Repro:** Throw from one file's progress callback while another file is still
  converting. The aggregate rejects before the sibling completes.
- **Root cause:** `Promise.all` rejected immediately. This pre-existing limitation
  was noted, but not reproduced, in the previous review.
- **Fix:** Await all started tasks with `Promise.allSettled`, then propagate the
  callback rejection. Keep eager dispatch and existing per-file failure results.
- **Test:** The sibling's completion is observable before aggregate rejection.
- **Code/tests:** [`convertMultipleFiles`](../../../src/clients/cli-client.ts),
  [CLI regressions](../../../tests/unit/cli-conversion-correctness.test.ts).

### F5 — [P2] Honor the per-batch output directory

- **Repro:** Supply `batch({ outputDir })` different from client configuration;
  completed files still appear under the client's default directory.
- **Root cause:** The pre-existing option was reported in batch events but never
  forwarded to job creation.
- **Fix:** Pass an explicit output root through the internal document-job path,
  without mutating reusable client configuration.
- **Tests:** Sequential and parallel batches place outputs beneath the requested
  directory and leave client settings unchanged.
- **Code/tests:** [`batch` and `runDocumentJob`](../../../src/clients/cli-client.ts),
  [CLI regressions](../../../tests/unit/cli-conversion-correctness.test.ts).

### F6 — [P2] Reject invalid batch concurrency before launch

- **Repro:** Supply `-1`, `1.5`, `Infinity`, `NaN` or `0` as `maxConcurrency`.
  The starting implementation can skip work or silently substitute a default.
- **Root cause:** The pre-existing chunking/default logic assumed a valid positive
  integer and used truthy fallbacks.
- **Fix:** Require a positive safe integer and use one chunk loop for sequential
  and parallel operation. Retain cleanup-before-abort behavior.
- **Tests:** All five invalid values reject before child invocation; existing
  cancellation tests still verify no queued chunks start after cancellation.
- **Code/tests:** [`batch`](../../../src/clients/cli-client.ts),
  [CLI regressions](../../../tests/unit/cli-conversion-correctness.test.ts).

### F7 — [P2] Apply API-key-only rotation and removal

- **Repro:** Make requests with an original key, call `updateConfig` with a new
  key, then clear it. Loopback HTTP still receives the original key each time.
- **Root cause:** The pre-existing transport-rebuild condition ignored `apiKey`;
  duplicated constructor/update setup made authentication behavior inconsistent.
- **Fix:** Share transport construction and trigger it when any transport field
  is explicitly supplied, including an empty/undefined key. Preserve custom
  header precedence and explicit zero retries.
- **Tests:** Real received headers show old/new/absent keys for both removal
  forms. Existing retry and custom-header tests remain passing.
- **Code/tests:** [`createHttpClient` and `updateConfig`](../../../src/clients/api-client.ts),
  [HTTP regressions](../../../tests/unit/http-retry-correctness.test.ts).

### F8 — [P2] Let the chunk service own task-manager destruction

- **Repro:** Register a pending task through the public chunk service's manager,
  wait for it, then destroy only that service. Its previous no-op destroy left
  the manager active; the parent client separately compensated for this.
- **Root cause:** Lifecycle ownership was in the caller rather than the service.
  The standalone-service gap pre-existed this fresh pass.
- **Fix:** `ChunkService.destroy()` destroys its manager; remove duplicate parent
  cleanup calls and use the service's lifecycle method consistently.
- **Test:** Direct destruction settles the waiter, removes active tasks and
  sends no polling request. Parent destruction/reconfiguration tests still pass.
- **Code/tests:** [`ChunkService.destroy`](../../../src/services/chunk.ts),
  [HTTP/lifecycle regressions](../../../tests/unit/http-retry-correctness.test.ts).

### F9 — [P2] Preserve the public split-page HTML format

- **Repro:** Request `html_split_page` through content, progress or ZIP conversion.
  All reject validation in the starting working tree, despite the public option.
- **Root cause:** The new shared validation rejected a format the old progress
  path forwarded. Main content conversion had also lacked complete mapping.
  Thus there is both a pending regression and a pre-existing mapping gap.
- **Fix:** Derive supported formats from the extension map; map this variant to
  `.html`, `html_content` and `outputs.html`, with HTML validation. Separate
  per-format directories and ZIP member names preserve both HTML variants.
- **Tests:** Content, progress, ZIP streaming and combined ordinary/split HTML ZIP
  cases. Inspected upstream Python source confirms `.html` naming with
  `split_page_view=True`; this is source evidence, not real converter execution.
- **Code/tests:** [CLI format maps and result adapters](../../../src/clients/cli-client.ts),
  [CLI regressions](../../../tests/unit/cli-conversion-correctness.test.ts),
  [synthetic executable](../../../tests/fixtures/cli-stub.mjs).
  The inspected source is retained at
  `.context/fresh-review-2026-11-06/python-cli-reference.py` from
  [upstream Python CLI](https://github.com/docling-project/docling/blob/main/docling/cli/main.py);
  that URL is mutable and is not a runtime pin.

## Simplicity and compatibility

- One batch conversion helper and chunk loop; remove duplicated sequential and
  parallel branches and the unused chunking helper.
- One HTTP transport factory for construction and configuration changes.
- Service-owned task cleanup; remove redundant parent ownership.
- `CliUtils` public methods delegate directly to the shared process runner;
  remove private forwarding wrappers, not public compatibility methods.
- Remove redundant format enumeration and UUID temporary-directory creation.
- Replace the stale package description and misleading service-pattern comments.
  Public exports, dependencies, version and lockfile are unchanged.
- Update the CLI, error-handling, configuration and task-lifecycle docs for actual
  behavior, including callback settlement and API-key reconfiguration.

Successful CLI output paths remain private per-job paths, as introduced in the
original correctness pass. ZIP output still inventories validated primary text
outputs, not a complete referenced-asset bundle. That pre-existing limitation is
not treated as a newly introduced regression or as fulfillment of the proposed
native contract. No production API/browser execution paths were replaced by a
native dependency.

## Final validation

Linux x64, Node **20.20.2**, installed Vitest **2.1.9**:

| Check | Result |
| --- | --- |
| `npm run typecheck -- --incremental false` | Pass |
| `npm run lint` | Pass |
| `npm run test:coverage` unit assertions | 383 tests, 21 files pass |
| `npm run test:coverage` command exit | **1 — all four coverage targets missed** |
| `npm run build` | Pass; nonfatal unused `$fetch` bundler warning |

| Production metric | Current | Required |
| --- | ---: | ---: |
| Lines | 46.26% | 80% |
| Statements | 46.26% | 80% |
| Branches | 69.39% | 80% |
| Functions | 46.04% | 80% |

Main CLI client line coverage: **69.97%**. The denominator remains all
`src/**/*.ts` except declarations; no threshold was reduced and no uncovered
production files were excluded. Source simplification also changes the
denominator, so percentage growth is not solely new-test coverage.

Machine-readable results:
[fresh-review-observations-2026-11-06.json](fresh-review-observations-2026-11-06.json).
Full command logs, check exits and coverage summary are retained under
`.context/fresh-review-2026-11-06/`.

## Remaining work, in order

1. Review the local correctness diff and compatibility changes. The original
   [R1–R7 repro/root-cause/fix plan](../../native-document-conversion-review.md#findings-and-intended-repairs)
   and implementation record remain the reference for the initial defects;
   this report covers the fresh pass. No release or delivery PR is created here.
2. Close the production behavior-coverage deficit without weakening the gate.
   CI, release validation and prepublish are intentionally **not green**. Recheck
   the previous production audit and remediate confirmed affected dependencies:
   `brace-expansion`, `glob`, `lodash`, `minimatch`, `ws`, `zod`. The six-entry
   count is from the earlier audit, not a new live audit or six proven exploits.
3. Validate real Python conversion and clean packed HTTP/browser/CLI consumers
   on the supported Node/OS matrix. This run proves neither Node 18 nor macOS/
   Windows behavior, browser engines, OCR quality, model readiness or real Serve
   integration. Windows process-tree termination remains best effort.
4. Select and approve a pinned Rust executable plus separately verified model
   manifest; prove licensed/synthetic PDF, scanned PDF, DOCX and PPTX behavior,
   partial/page/asset completeness, offline operation and cancellation.
5. Only then implement the narrow additive `docling-sdk/native` entry point and
   verify packed consumers before explicit adoption. Preserve Python selection,
   existing HTTP/browser consumers and Wayfinder's independent Dart integration.
   Do not invent a custom native ABI or silently change backends.

The fresh pass establishes local regression evidence and fixes; it does not
establish release readiness, complete coverage, native parity or merge status.
