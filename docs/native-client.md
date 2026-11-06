# Optional native client

[Home](../README.md) > [Docs](README.md) > Native client

The additive `docling-sdk/native` entry runs a pinned **docling-rs 2.53.1**
executable in a separate, isolated process. It does not change the root factory,
Python CLI, HTTP or browser clients. This is an unreleased feature in the PR
stack, not an alternative already available in the published 2.0.7 package.

## Supported scope

| Capability | First profile |
| --- | --- |
| Runtime | Node >=18, Linux x64; Ubuntu 24.04 is the validation target |
| System dependencies | glibc 2.39 profile, compatible libstdc++ (`GLIBCXX_3.4.32`), administrator-provided Bubblewrap |
| Isolation | User, PID, network and mount namespaces, private procfs, private writable job and temporary directories |
| Inputs | One local regular PDF, DOCX or PPTX, up to 50 MiB |
| Outputs | Markdown and/or original structured JSON, plus owned referenced raster assets |
| Models | Pinned Heron layout, PP-OCR v6 and TableFormer graphs and external weights; CPU execution |
| Fonts | Pinned Noto Sans/Serif and monospace fallback faces, with OFL notices; not worldwide script coverage |
| Excluded | macOS, Windows, Linux ARM, browser/Deno/Bun execution, URL/directory/archive inputs, remote images, VLM, GPU, ASR, S3, watch, custom models or arbitrary CLI flags |

The manifest is bundled; executables, models and fonts are **not** in npm.
Importing or creating a client does not download, install or run anything.
Office inputs require the optional `fflate` and `saxes` packages. With npm's
`--omit=optional`, imports and PDF processing remain available, but Office
conversion rejects with a configuration error until these are installed.

## Explicit setup

Install Bubblewrap through your system administrator/package manager. The kernel
must allow its namespaces and a **new private `/proc` mount**. Ubuntu 24.04
may require an administrator-managed AppArmor profile permitting user namespaces
for `/usr/bin/bwrap`; installing the executable alone is insufficient. The CI
fixture provisions that narrowly scoped profile without disabling the global
unprivileged-user-namespace restriction. The SDK/setup script never changes
AppArmor or kernel policy. The backend fails
closed when these are unavailable; it does not use host procfs, disable isolation,
change global environment, install a loader, or fall back to Python/HTTP.

From an installed package, explicitly run:

```sh
# The parent directory must already exist; the destination must not exist.
node node_modules/docling-sdk/scripts/prepare-native-runtime.mjs /absolute/path/docling-runtime
```

In a checkout, run `npm run build` first and use `node scripts/prepare-native-runtime.mjs`.
The setup script downloads the reviewed archive and each pinned model/font/notice,
checks exact sizes and SHA-256 values, inspects the archive before extraction, and
publishes a new installation without overwriting an existing destination. It
requires GNU `/usr/bin/tar` and `/usr/bin/mv`. No Rust compilation or Python setup.
Allow approximately 500 MB for the installed profile, plus staging space.
Interrupted/failed setup removes its private staging; rerun to a new destination.
A digest mismatch is an error, not permission to trust a newer upstream asset.

Setup prints `executable`, `modelDirectory` and the path to `install-receipt.json`.
Keep this receipt outside the model directory: readiness rejects extra files,
missing assets and symlinks in the reviewed installation. Setup downloads bytes;
`checkRuntime()` separately verifies whether they can start on this host.

## Conversion

```typescript
import { createNativeClient, NativeError } from "docling-sdk/native";

const client = createNativeClient({
  executable: "/absolute/path/docling-runtime/docling-rs",
  modelDirectory: "/absolute/path/docling-runtime/models",
  // bubblewrapPath: "/usr/bin/bwrap", // default, absolute administrator-owned path
});

await client.checkRuntime({ timeoutMs: 120_000 });

const controller = new AbortController();
try {
  const result = await client.convertFile("./report.pdf", {
    outputDirectory: "./converted",
    formats: ["md", "json"],
    timeoutMs: 120_000,
    signal: controller.signal,
  });
  if (result.status !== "success") {
    console.error(result.status, result.warnings);
  }
  console.log(result.outputDirectory, result.files, result.coverage);
} catch (error) {
  if (error instanceof NativeError) console.error(error.code, error.message);
  else throw error;
}
```

Every call snapshots the input, rehashes the exact reviewed installation and runs
one converter in a private job. No shared progress state, output filename search,
ambient model lookup, inherited proxy/token environment or automatic retries.
Outputs are checked before publication into a new `docling-native-*/files`
directory beneath the requested output root. Only files in the returned receipt
are published. Existing caller files are not overwritten. The caller owns and
may remove the completed job directory.

Trust the local administrator, installation and output-root ownership: this is
process/document isolation, not a defense against a concurrent hostile process
running as the same OS user or a compromised kernel. Do not modify the runtime
while conversions are active. Document text and diagnostics are untrusted data;
render Markdown/HTML with the application's normal content-sanitization policy.

### Options

| Option | Meaning |
| --- | --- |
| `formats` | Unique nonempty selection of `md`/`json`; defaults to both. Both are internally produced for validation. |
| `outputDirectory` | Local destination root; each successful/partial call publishes a fresh job. |
| `signal` | AbortSignal; abort terminates the owned process tree and cleans incomplete work before rejection. |
| `timeoutMs` | Whole-operation deadline, default 120000, maximum 900000; termination/cleanup must finish before rejection. |
| `pageRange` | Inclusive one-based PDF range, for example `[2, 4]`; unsupported for Office. |
| `documentTimeoutSeconds` | Positive PDF cooperative processing budget, at most 900; may return partial output. Not a hard deadline. |

Other options reject. Output inventory is limited to 256 files and 128 MiB;
Office ZIP expansion to 256 MiB/10,000 entries, XML parts to 16 MiB. ZIP64,
encrypted archives and externally fetched Office relationships are unsupported.
PPTX requires at least one valid slide; zero-slide packages reject before launch.
Ordinary hyperlinks are preserved but never followed by the SDK. Input/file
references, ZIP members and emitted assets are validated for ownership and
unsupported links; malformed data cannot select another document's output.

## Results and errors

`success` means the pinned engine reported success and both internal formats and
structural coverage passed validation, with no recognized degradation warning.
It is **not** a promise of extraction accuracy, full linguistic coverage or parity
with Python. OCR/model startup and output quality require real fixture evidence.

`partial_success` preserves an engine partial result, a warning, a missing/invalid
format, or unknown/incomplete page coverage. Inspect `warnings` and `coverage`;
do not publish a complete capture merely because some files exist. `failure`
returns no files or output directory when no requested output validated or the
engine reported an ordinary document-conversion failure.

- `files`: owned relative paths, kinds, byte counts and SHA-256 values.
- `document`: unmodified parsed upstream JSON, only if requested and validated.
  Its origin hash is not relabeled as the original-file SHA-256.
- `input`: caller filename, input type, actual snapshot size and SHA-256.
- `coverage`: completed page numbers and expected/requested range where available.
  PDF is **engine-reported**; PPTX is checked against its package slide list;
  DOCX pagination is **not reported**. Structural coverage is not OCR-quality proof.
- `runtime`: exact profile, engine/version/commit, executable and manifest hashes,
  platform and isolation identity.

Rejected operations use `NativeError.code`: `INVALID_CONFIGURATION`,
`UNSUPPORTED_PLATFORM`, `RUNTIME_UNAVAILABLE`, `RUNTIME_INTEGRITY`,
`ISOLATION_UNAVAILABLE`, `INVALID_INPUT`, `INVALID_OUTPUT`, `EXECUTION_FAILED`,
`ABORTED` or `TIMEOUT`. Abnormal exits, missing/contradictory engine diagnostics,
cancellation and hard timeout are not conversion success. Causes may contain
bounded upstream diagnostics; avoid indiscriminately logging them for private documents.

## Ownership and validation

The SDK owns conversion and its output receipt. Wayfinder remains a separate
Dart consumer of the upstream executable, sharing version/asset pins and fixtures
where useful. It owns Knowledge placement, provenance, publication policy and
bundle transactions; neither repository needs a dependency on the other.
Upstream Node bindings already exist. This implementation adds no native ABI.

The [native validation record](review-evidence/native-conversion/native-backend-2026-11-06.md)
distinguishes unit/stub tests, retained real-engine probes and actual packed SDK
CI runs. The earlier [design review](native-document-conversion-review.md) is
historical context. No speed/parity, cross-platform or browser-OCR claim follows
from the Linux tests. The release workflow requires the real-runtime CI gate. Review
its current results, not just workflow presence.
