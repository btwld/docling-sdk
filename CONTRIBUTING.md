# Contributing to Docling SDK

## Local setup

```bash
git clone https://github.com/btwld/docling-sdk.git
cd docling-sdk
npm ci
```

Use Node.js 20.19+ (or 22.12+) for the development toolchain. Published SDK
runtime support remains Node.js >=18; TypeScript consumers need >=5.5.
Submit changes through a pull request to `main`.

## Checks

Run the checks relevant to your change before opening a PR:

```bash
npm run typecheck
npm run lint
npm run openapi:check
npm audit
npm run test:coverage
npm run build
npm run validate:package
```

Use Biome for formatting (`npm run format:fix`). See [package.json](package.json)
for other scripts and [vitest.config.ts](vitest.config.ts) for test configuration.

Unit tests live in `tests/unit/`. Integration tests live in `tests/integration/`
and require their external services. Set `DOCLING_TEST_SERVE_URL` and
`DOCLING_TEST_FIXTURES` to run the real Serve suite; otherwise it explicitly skips.
`npm test` runs unit tests. The old comment-only S3 scaffold has been removed.
CI, release validation and `prepublishOnly` run `npm run test:coverage`,
measuring `src/**/*.ts` and enforcing 80% for
lines, branches, functions and statements. A passing unit suite alone does not
establish that the coverage gate passes; the coverage command exits nonzero
when any target is missed.

CI exercises the toolchain on Node 20/22/24. Packed-consumer tests install both
full and optional-dependency-free artifacts, compile declarations on the minimum
TypeScript version, bundle browser imports and make loopback HTTP requests on
Linux/macOS/Windows with Node 18/24. Runtime/model validation scripts under
`scripts/validate-python*` are explicit opt-in operations with isolated caches;
they do not run during installation or change the SDK backend.

## Changes and commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), such as
`fix(api): handle a missing task result` or `docs: clarify browser setup`.
The [PR-title check](.github/workflows/pr-title.yml) validates the PR title.
Describe behavior changes, compatibility effects and validation in the PR.

Keep SDK types, runtime schemas and adapters consistent when changing API
contracts. Check public entry exports and client-specific capabilities when
updating examples. See the [TypeScript guide](docs/typescript.md).

## Releases

The [release workflow](.github/workflows/release.yml) owns version bumps on `main`.
Do not manually bump `package.json` as the normal contribution workflow.

- On pushes to `main`, the workflow examines conventional commits since the last
  tag, skips excluded changes such as documentation-only commits, and determines
  whether to release. Version selection uses the workflow's own heuristics.
- Maintainers can run **Actions → Release → Run workflow**, choosing `auto`,
  `patch`, `minor` or `major` to override version selection.
- There are no automatic push-triggered releases from `next`, `beta` or `alpha`.

The workflow commits version and changelog updates, publishes packages and
creates the release. A failed run can leave intermediate commits or tags behind;
inspect the run, published versions and repository state before retrying. Do not
assume a failed run made no changes. PRs [#62](https://github.com/btwld/docling-sdk/pull/62),
[#63](https://github.com/btwld/docling-sdk/pull/63) and
[#64](https://github.com/btwld/docling-sdk/pull/64) document previous recovery work.

## Reporting issues

Include the client mode, runtime/version, minimal reproduction and actual error.
For server behavior, include the Docling Serve or Python Docling version.

## License

Contributions use the [BSD-3-Clause license](LICENSE).
