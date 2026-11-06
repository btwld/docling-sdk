# SDK hardening and delivery validation — 2026-11-06

For subsequent optional Rust work, see the [native implementation record](native-backend-2026-11-06.md). This document records the earlier six-PR hardening milestone.

This record supersedes the readiness conclusions in the earlier dated reviews,
without rewriting their observations. Python remains the local backend. The
optional Rust executable backend is **not implemented** and no package is released
by this work. Wayfinder remains an independent Dart consumer.

## Original defects and regression contract

| Finding | Repair | Verification |
| --- | --- | --- |
| R1: shell interpretation | One executable/argv runner, `shell: false`; explicit Python prefix arguments | Literal substitutions, quotes, Unicode, spaces and executable paths reach a harmless child unchanged |
| R2: false conversion success | Derive status from validated requested outputs; retain partial/failure and upstream errors | Nonzero, empty, malformed, missing-format, partial and signal outcomes; real corrupt PDF |
| R3: unrelated output reuse | Unique private jobs, input snapshots, closed output/asset inventory | Stale outputs, same-basename concurrency, symlink/hard-link refusal, cleanup and portable ZIP assets |
| R4: lost task completion | Persistent task-filtered settlement and retained terminal state | Concurrent success/failure, wait-after-completion, cancel/destroy and listener cleanup |
| R5: false readiness/signal success | Require availability; separate exit code and signal; await cleanup | Missing executables, SIGTERM, timeout/abort, descendants, real Python child timeout |
| R6: discarded zero retries | Nullish defaults and explicit forwarding through public API | Loopback retry counts, zero timeout/retry, configuration/key rotation |
| R7: ineffective coverage gate | Direct global thresholds over production sources; CI and prepublish run it | Disposable undercovered fixture must fail; fully covered fixture passes; all four targets stay at 80% |

The initial probes intentionally asserted the old failures. They are historical
evidence, not the fixed-code regression suite. Current behavior tests live in
`tests/unit/` and invoke public operations or real subprocess/HTTP boundaries.

## Independent review and simplification

Sol 6.1 workers used high reasoning and fast service priority. Separate reviewers
read actual source diffs and callers. API and platform review each found three
introduced regressions; fixes cover error-observer settlement, bounded HTTP error
bodies, remaining active sockets, concurrent monitoring startup, monitoring retry
state, and nonfatal browser event observers. A second reviewer reproduced and
verified the fix for an additional stop-during-retry reentrancy race. The CLI review additionally found
watcher snapshot recursion, directory-source regression, URL naming/repeated
download, and two JSON asset rewriting defects. Follow-up reviewers also caught
symlink-alias watcher recursion, ancestor output roots suppressing directory
inputs, Google document export normalization, and deferred watcher-stop notification.
Those corrections passed independent focused re-review. Delivery review and its scoped dependency fix
also completed re-review without remaining findings. The final full coverage
run exposed a one-second test polling limit below real child startup under load;
the wait allowance changed, with every ownership assertion retained. The first
Node 22 CI run additionally exposed add/change notifications during non-atomic
fixture writes. The fixture now publishes completed caller files using atomic
rename; exact direct-layout counts and all job-ownership assertions remain.

The work consolidates local subprocess and batch paths, HTTP configuration and
request dispatch, task cleanup ownership, and exact job-output validation.
It removes the unused, unexported connection pool and the comment-only S3 test
scaffold. Existing package entry points and public compatibility adapters remain.

Packed-consumer checks caught and repaired browser bundling of Node-only imports
and extensionless ESM declarations. Node capabilities are loaded only on the
paths needing them; declaration imports are resolved against emitted files, then
compiled in clean NodeNext consumers with TypeScript 5.5.4. Optional ZIP support
uses lazy `fflate`, with no custom ZIP implementation or native ABI.

## Real runtime evidence

The isolated Linux runtime contains Python 3.9.25, Docling/Core 2.60.1,
IBM Models 3.10.3, Parse 4.7.3, and CPU Torch 2.8.0. Synthetic fixtures verify:

- DOCX prose, tables and an embedded image.
- PPTX tables/images and speaker notes.
- Two-page PDF text, both page keys and per-page provenance.
- Scanned PDF text actually recognized by RapidOCR, with page provenance.
- Corrupt PDF failure without fabricated JSON output.
- Repeated format/input flags, OCR selection, table options and explicit OCR false.
- Markdown/JSON/HTML ZIPs containing real PNG bytes and resolvable references,
  rechecked after the ZIP dependency replacement.
- SDK process timeout retaining its typed cause and cleaning incomplete jobs.

Layout and accurate TableFormer weights were downloaded at recorded revisions
and verified against upstream digests. RapidOCR assets use upstream-pinned URLs;
their local hashes are recorded, but no upstream digest was supplied. No global
Python/model environment was changed. These are explicit validation installs,
not SDK installation behavior.

A separate real Serve 1.7.2 process passed health, multipart/base64 DOCX,
async status/result, and ZIP download integration checks. Its actual OpenAPI
schema is pinned in `openapi/docling-serve.json`, with a digest and the full
generation environment in `openapi/schema-provenance.json`. Generated types are
checked for reproducibility; endpoint examples compile rather than resolving to
placeholder `any` types.

## Toolchain and compatibility corrections

- Runtime Node >=18 remains supported. Development tools require Node 20.19+
  or 22.12+. TypeScript consumers require >=5.5, matching the actual Zod baseline.
- Updated locked production dependencies; removed the archiver dependency chain.
  Added the previously undeclared `chokidar` runtime dependency.
- Vitest/UI/coverage are pinned together at 4.1.12. Coverage algorithm changes
  mean its percentages are not directly comparable to earlier Vitest 2 reports.
- Development glob/minimatch overrides are tested by building the package and
  documentation. TypeDoc retains a scoped, patched minimatch 6.2.3-compatible
  dependency because minimatch 11 removed its required public `matchOne` API.
  Independent delivery review found Redocly also needs its callable CommonJS
  matcher API: its scoped override uses patched minimatch 5.1.9, verified by a
  public OpenAPI generation test with actual loopback HTTP header matching.
  No advisory is suppressed. TypeDoc output now goes to `build/api-docs`, not the
  handwritten `docs/` directory. Generated-schema/JSDoc warnings remain visible.
- Browser API smoke tests use actual headless Chrome, File/multipart/fetch and
  the packed artifact. Browser bundling is checked with optional dependencies
  both present and omitted. This is **not** a browser OCR/model-quality test.
- CI checks the development toolchain on Node 20/22/24 and clean packed consumers
  on Linux/macOS/Windows with Node 18/24, including actual child-process execution.
  Remote jobs must be evaluated from their live results, not inferred from config.

## Final local validation

Linux x64, Node 20.20.2, Vitest 4.1.12; exact tool versions are retained in the
runtime/check logs. The complete gate also passed on Node 22.23.4 after the
atomic-fixture correction, with the same 887 tests and coverage percentages.
Its five real-watcher cases passed independent re-review. All checks below
completed successfully unless noted.

| Gate | Result |
| --- | --- |
| TypeScript, Biome, pinned schema regeneration | Pass |
| Full production coverage suite | 887 tests, 50 files |
| Coverage (lines / statements / functions / branches) | 95.86% / 94.49% / 94.61% / 85.6% |
| Enforced coverage thresholds | 80% for each metric; independent failing/passing fixtures verify enforcement |
| Full dependency audit | Zero vulnerabilities, including development dependencies |
| Build and packed consumers | Node 18, 20 and 24; full and omitted optional dependencies |
| Packed TypeScript declarations | Minimum TypeScript 5.5.4, NodeNext, `skipLibCheck: false` |
| Packed browser API | Real headless Chrome with File/multipart/fetch; browser bundles without Node shims |
| Real Serve 1.7.2 | Three integration tests pass |
| Real Python 2.60.1 | Text/scanned PDF, DOCX, PPTX, corrupt input, timeout and referenced assets; Unicode/dollar filenames rechecked after ZIP changes |
| Documentation build | Pass; 390 existing/generated-schema/JSDoc warnings remain visible |
| Remote packed consumers | Passed on Linux/macOS/Windows, Node 18/24 ([run](https://github.com/btwld/docling-sdk/actions/runs/42288541626)); this first run also retained the Node 22 fixture failure described above |

The original clean baseline was 154 passing tests with 23.17% broad line coverage
(28.27% when restricted to production sources). The denominator and Vitest coverage
algorithm changed, so percentages are not a direct quality or speed comparison.

## Reviewable delivery order

1. **[Process lifecycle](https://github.com/btwld/docling-sdk/pull/88)** — one shell-free runner, typed termination, output bounds,
   cleanup and compatible `CliUtils` adapter. Clean-layer checks: 236 unit tests.
2. **[Browser and WebSocket lifecycle](https://github.com/btwld/docling-sdk/pull/89)** — worker/resources, observer failures,
   monitoring/reconnection and lazy Node boundaries. Clean-layer checks: 399 tests.
3. **[Pinned Serve contracts](https://github.com/btwld/docling-sdk/pull/90)** — actual schema/provenance, reproducible generation
   and runtime validation parity. Clean-layer checks: 421 tests.
4. **[HTTP/API/task lifecycle](https://github.com/btwld/docling-sdk/pull/91)** — options/retries, concurrent task settlement,
   progress ownership, bounded errors and removal of the unused pool. Clean-layer
   checks: 680 tests.
5. **[Conversion ownership and assets](https://github.com/btwld/docling-sdk/pull/92)** — snapshots, complete output inventory,
   truthful status, directories/URLs/watchers, ZIP assets, production dependency
   fixes and reproducible Python probes. Clean-layer checks: 884 tests. The only
   subsequent edit extended real-watcher test polling; the final 887-test gate
   includes that edit, two coverage-gate tests and the Redocly compatibility regression.
6. **[Delivery gates and documentation](https://github.com/btwld/docling-sdk/pull/93)** — toolchain audit, declaration finalization,
   clean packed consumers, CI/coverage enforcement, removal of the comment-only
   S3 scaffold, synchronized contracts and preserved review evidence.

Every clean layer passed typecheck, lint, tests and build from its committed
lockfile. Layers are intended to be reviewed in order. The six PRs are drafts; none has merged. Native Rust work follows
these correctness and delivery gates, not a silent backend replacement. Read the
current [top-PR checks](https://github.com/btwld/docling-sdk/pull/93/checks) for
validation of subsequent commits rather than extrapolating from the initial run.

## Explicit remaining limits

1. Python 2.60.1's standard pipeline took about 50 seconds with an internal
   `document_timeout` of one second. The SDK hard child-process timeout is a
   separate, verified mechanism. Its legacy CLI plus explicit artifacts path
   crashes upstream. Both failing repros are retained rather than reported green.
2. The official Python API independently produced `partial_success` for four of
   32 pages, with a deadline warning and no errors. This does not establish that
   Python's CLI exports partial results or full page coverage. Unsupported CLI
   `page_range` rejects; default OCR selection is left to the installed converter.
3. API advanced option objects are version-specific passthrough. Serve 1.7.2 does
   not declare several advertised nested OCR/layout/accelerator fields. Supported
   chunk fields are checked against the actual schema; wire presence alone is
   not evidence that a server implements an option.
4. The legacy async task wrapper remains document-typed. Retrieve ZIP tasks with
   `getTaskResultFile(taskId)`, not its JSON `getResult()` reader. S3/PUT result-type
   redesign and server-side cancellation are not claimed by this additive pass.
5. Browser OCR needs an explicit bundler-produced worker URL. The legacy bare-
   import blob fallback is not self-contained. Real transformer inference,
   WebGPU/WASM quality and CSP compatibility were not exercised here.
6. HF offline flags are not OS-level proof of no egress. Windows process-tree
   termination remains best effort; descendants deliberately leaving a POSIX
   process group are outside the runner's ownership. No performance/parity claim.
7. The native engine still needs a reviewed executable/model pin, fixture and
   offline/cancellation proof, then a narrow additive `docling-sdk/native` entry
   point and clean-consumer matrix. Do not change Python's default, couple the
   Dart/TypeScript repositories, or invent custom Node bindings.

## Evidence and preservation

All worker prompts/reviews/probes, failed and passing checks, per-layer clean
checkouts, package consumers, model manifests, runtime outputs and original
workspace backups are retained in `.context/release-hardening-2026-11-06/` (packed
consumer paths are recorded in the check logs). Reproducible real-runtime scripts
are under `scripts/validate-python*`; live Serve tests are opt-in under
`tests/integration/`. Older `.context/` directories and dated JSON reports remain
unchanged. Neither local evidence nor intermediate validation is a claim that
changes have merged or packages have been published.
