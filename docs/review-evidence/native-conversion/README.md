# Conversion review evidence

Historical files preserve the 2026-10-29 cloud reproductions against
`5ae3517a57d3a803845f1c7d10aa6749c309a4e0`, before the correctness fixes. Dated
validation records below describe the subsequent local implementation.

- `probes.ts`: seven defect assertions for R1–R6, using synthetic files, stub
  executables, local task events and loopback HTTP. Passing means the defects
  reproduced. This script is expected to fail after the fixes; it is not part of
  the regression suite and should only be rerun against an isolated baseline.
- `coverage-gate.mjs`: a disposable installed-Vitest experiment comparing nested
  and direct thresholds. It does not modify the repository configuration.
- `correctness-observations.json`: historical 2026-11-03 correctness validation,
  production coverage and remaining gates, kept separate from historical probes.
- [fresh-review-2026-11-06.md](fresh-review-2026-11-06.md): fresh correctness
  review, local fixes, regression evidence and remaining release gates.
- `fresh-review-observations-2026-11-06.json`: earlier same-day check results and coverage; superseded by the delivery record below.
- `baseline-observations.json`: retained runtime/gate results and clean-baseline
  coverage. No real converter, OCR, models or external document server was used.

The historical commands were `node_modules/.bin/tsx
docs/review-evidence/native-conversion/probes.ts` and `node
docs/review-evidence/native-conversion/coverage-gate.mjs`. They write synthetic
fixtures/results beneath ignored `.context/native-review/` and install nothing.

Current behavior belongs in the unit regression suite, including
`tests/unit/cli-conversion-correctness.test.ts`, `process-runner.test.ts`,
`cli-process.test.ts`, `async-task-manager.test.ts`,
`http-retry-correctness.test.ts`, `file-task-lifecycle.test.ts` and
`coverage-gate.test.ts`.
The [review](../../native-document-conversion-review.md) separates historical
observations and the proposed native backend. See the
[latest SDK hardening record](release-hardening-2026-11-06.md) for real-runtime,
packed-consumer, dependency and delivery validation. Earlier dated evidence is
preserved unchanged and must not be interpreted as the current readiness state.
