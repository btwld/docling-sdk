# Optional native backend — implementation and validation

Date: 2026-11-06. Status: **implemented in an unmerged, unreleased PR stack**.
The [native guide](../../native-client.md) is the contract; the original
[design/review](../../native-document-conversion-review.md) remains historical.
Python/API/browser defaults and imports remain unchanged. No package release,
merge, custom native ABI, TypeScript-to-Dart dependency or implicit setup.

## Implementation

1. **Pinned runtime and isolation.** Explicit `docling-rs` v2.53.1, commit
   `f6012c104ab395e97415b0b078e7aee9e4df4bf1`; Linux x64 CPU profile. The archive,
   executable and every model, external weight, font and attribution asset have
   exact size/SHA-256 pins. Runtime readiness rechecks the closed inventory on
   every call, then starts the exact executable in mandatory Bubblewrap isolation.
2. **Artifact boundaries.** Snapshot a local PDF/DOCX/PPTX to a private job. Bound
   Office ZIP expansion and XML; reject unsafe/missing/external parts. Validate
   the pinned batch-of-one protocol, both internal output formats, page coverage,
   image references, file ownership, types and byte limits. Preserve raw JSON.
3. **Explicit public API/setup.** `docling-sdk/native` exposes a narrow client,
   typed failure/abort/timeout and success/partial/failure outcomes. The separate
   setup CLI verifies all downloads, checks archive members and publishes with
   no-clobber semantics. It is not an import-time/npm lifecycle installer.
4. **Delivery gates.** Clean packed consumers, reproducible synthetic fixtures,
   mandatory compatible Linux real-engine tests and synchronized documentation.
   Other platforms fail explicitly; neither Python nor a remote service is a
   fallback for native errors.

## Additional findings resolved before delivery

- **Model degradation without procfs.** A real isolated executable emitted ONNX
  initialization errors, silently degraded and reported success when `/proc`
  was absent. Every launch now requires a new PID-namespace-scoped procfs,
  never a host `/proc` bind. Recognized ONNX/cpuinfo errors and missing-font
  diagnostics also prevent a full-success result even if exit status is zero.
- **Missing fallback fonts.** Without host or bundled fonts, ordinary PDF text
  rendered as boxes. The manifest now pins Noto Sans/Serif and Mono faces plus
  OFL notice. A network-isolated rendering control confirmed readable text
  versus boxes. Mono resolver filenames are aliases: the two `LiberationMono-*`
  files contain unchanged Noto Sans Mono bytes, not Liberation fonts. Mono italic
  falls back to upright; Latin/Greek/Cyrillic coverage is not universal glyph support.
- **Rejected artifacts published on partial success.** A public-boundary probe
  showed an invalid requested format omitted from receipts but still published.
  Publication now moves only validated receipt files into a separate staging
  directory. Malformed Markdown/JSON and omitted-asset controls verify exact
  inventory equality. Independent review confirmed the correction.
- **Setup commit/cancellation disagreement.** Independent review reproduced a
  SIGTERM between final rename and child close: failure was reported for an
  already-complete install. Setup now reconciles the exact staging inode after
  the publication attempt. Committed installs report success; uncommitted
  cancellation fails and cleans staging; collisions preserve caller data.
  SIGINT/SIGTERM and raced-collision regressions pass.
- **Model execution was not established by plain table/text assertions.** Independent
  review showed geometric fallback could satisfy the simple table checks. The
  real-runtime gate now additionally requires positive layout, OCR detector/recognizer
  and TableFormer encoder/decoder/bbox execution timings in the same sandbox,
  clean diagnostics and valid content. A follow-up review caught silent terminal
  inference failure despite timings; the gate additionally requires first-class
  PDF table-cell geometry that the pinned geometric fallback cannot emit. Independent
  re-review closed this finding for the pinned fixture: 44 probe/parser controls
  and 39 independent structure controls pass. Compatible live CI then passed both
  model probes, including six first-class TableFormer cells.
- **macOS setup CLI path aliases.** Packed-consumer CI found that the import/main
  guard compared a real module path to a symlink-spelled argv path and did nothing.
  Canonicalizing both paths fixes macOS aliases and Windows path spelling; the
  60-case setup suite includes a symlinked invocation regression. Native conversion
  is still explicitly Linux-only.

Input/output validation uses `fflate` and `saxes`, not a native ABI or
new general plugin/runner framework. The existing shell-free process runner
owns process lifecycle. ZIP/header checks are needed before bounded inflation;
engine-specific validation is not replaced by TypeScript casts. Independent
review found no justified broad simplification of these distinct boundaries.

## Local evidence and limits

The exact upstream executable cannot start with this VM's glibc 2.34. Earlier
real-engine probes used a separately verified compatible loader **only as an
explicit test harness**, with network isolation. They cover digital/scanned PDF,
DOCX/PPTX tables/images/notes, partial output, corrupt inputs and negative model
controls. They do not establish the production SDK Bubblewrap pipeline.

A later probe found this VM also refuses a new private procfs mount. The SDK
correctly rejects `ISOLATION_UNAVAILABLE`; six live sandbox unit tests skip with
the concrete capability failure. Deterministic tests still require isolation
flags and fail-closed outcomes. **Do not relabel these skips or loader-assisted
engine tests as a full local native SDK pass.** The compatible Ubuntu CI gate
must run the packed SDK and real model pipeline with no isolation skip/fallback.

The setup CLI was exercised with the actual pinned archive/models/fonts using a
local exact-URL replay harness, then independently rehashed. Archive/model
attribution cross-links and all nine selected graph/dictionary hashes agree with
the pinned upstream `models.json`/`export_record.json`. License/notice downloads
also include the exact engine MIT license and ONNX Runtime 1.31 project license
and third-party notices. This is not an independently reconstructed binary SBOM.
No executable/model/font bytes are included in the npm artifact.

The first compatible Ubuntu CI runs verified all downloads and fixture
reproducibility but failed closed before inference: Ubuntu AppArmor denied
Bubblewrap network-namespace setup (`Failed RTM_NEWADDR`). The CI fixture now
provisions a profile for the exact administrator-installed `/usr/bin/bwrap`,
leaving the global restriction enabled. Neither SDK nor setup changes host
security policy. Those failed runs remain evidence, not conversion passes.

## Compatible CI — actual packed SDK

[Run 42314024997](https://github.com/btwld/docling-sdk/actions/runs/42314024997)
passed **26 required gates on each of Node 18.20.8 and 24.22.2** on Ubuntu 24.04
x64, at commit `e4cbecf1ad41497a2d5becd929240397b4b71e72`. This was the actual
packed npm consumer and explicitly installed pinned runtime, without an alternate
loader, stub converter, isolation skip or Python fallback. The permanent
[compact receipts](native-live-validation-2026-11-06.json) record exact validator,
package, manifest and original summary hashes. Full bounded artifacts are retained
locally as well as in the workflow's time-limited artifacts.

- Digital/scanned PDF, DOCX and PPTX pass content, table, image-byte, schema,
  reference, page-range and speaker-note checks. Layout/TableFormer and OCR
  detector/recognizer execution are independently established for the fixtures.
- Live no-egress, private procfs, hidden host files, read-only models and separate
  namespaces pass. SDK imports/conversions make no setup/download calls.
- A one-second cooperative budget preserves one of 256 pages as `partial_success`
  with incomplete coverage and warnings. Abort and hard deadline observe a real
  engine first, then require its descendants gone and staging empty.
- Same-basename concurrent requests publish separate jobs and requested formats.
  Corrupt inputs and missing/corrupt models reject or return an unpublished
  failure as specified; the installation and all fixtures finish unchanged.
- Empty DOCX produces a valid empty document. Zero-slide PPTX is outside the
  input contract and rejects before process launch. The first live run exposed
  an incorrect validator expectation for this case; the correction did not
  weaken input validation or accept an arbitrary conversion outcome.

### Recorded checks

| Gate | Result |
| --- | --- |
| Latest complete CI coverage run ([Node 20](https://github.com/btwld/docling-sdk/actions/runs/42313808817/job/128221404949)) | 1,199 passed; no skips; 56 files |
| Earlier local production coverage run | 1,189 passed; six explicit sandbox capability skips; 56 files |
| Coverage lines / statements / functions / branches | 94.73% / 93.09% / 94.86% / 84.60%; all enforced 80% gates pass |
| Setup suite after cancellation/CLI-alias repairs | 60 passed, no skips |
| Packed consumers | Linux/macOS/Windows on Node 18/24 pass; full/omitted optional dependencies, subprocess/loopback HTTP and TypeScript 5.5.4 NodeNext checked; local real Chrome API/browser bundling also pass |
| Actual native SDK | 26 gates pass on both Node 18/24, including model execution, no-egress, partial outcomes and process cleanup |
| Typecheck / lint / schema / build / audit | Pass on Node 20/22/24; audit reports zero vulnerabilities |
| Native bundle/import boundary | No model/executable/font payload; optional setup help and native import available without installation; root/browser exports unchanged |
| Independent reviews | Artifact publication, setup commit/cancellation and final model-execution discriminator confirmed after repairs |

Coverage records include production sources intentionally; the original
154-test/23.17% broad baseline used another denominator and Vitest version.
The setup regression additions are included in the latest CI count. Local
sandbox capability skips are not counted as passes; compatible CI has none.
The [PR checks](https://github.com/btwld/docling-sdk/pull/98/checks) remain the
source of truth for later commits, not an extrapolation from this dated record.

## Preserved evidence

Local-only working records are retained in `.context/native-backend-2026-11-06/`:
engine contract/source pins, runtime command ledger and outputs, isolation probes,
model attribution, before/after font renderings, independent reviews,
publication/degradation/setup red-green logs, clean per-layer checkouts and packed
consumer logs. Previous `.context/` evidence and original workspace material remain.
Reproducible code is checked in under `scripts/validate-native*` and
`tests/unit/native-*`; CI uploads bounded receipts on pass or failure.

## Adoption and release boundary

Review in stack order: existing R1–R7 hardening and delivery (#88–#93), then [runtime #95](https://github.com/btwld/docling-sdk/pull/95),
[artifact validation #96](https://github.com/btwld/docling-sdk/pull/96),
[client/setup #97](https://github.com/btwld/docling-sdk/pull/97) and
[real-runtime validation #98](https://github.com/btwld/docling-sdk/pull/98).
No parity/speed claim is made. macOS/Windows/ARM, broader glyph/language quality,
real browser transformer inference and existing Python CLI upstream limitations
remain outside this native profile. Wayfinder's Dart runner remains separate and
must reject incomplete captures according to its own publication policy.
