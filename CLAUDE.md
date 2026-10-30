# Working on Docling SDK

TypeScript clients for Docling Serve, the local Python CLI, and browser OCR.

## Verify changes

- `npm run typecheck`
- `npm run lint`
- `npm test` (unit tests)
- `npm run build`

See `package.json` for other scripts and `vitest.config.ts` for test policy.
Integration tests need external services; file presence is not coverage.

## Preserve contracts

- Keep Node-only CLI imports out of `src/browser-entry.ts` and Web paths.
- Check `package.json` exports when changing public symbols or entry points.
- `src/types/api.ts` is the manual SDK contract; check schemas and adapters too.
- OpenAPI types contain placeholders; do not claim endpoint coverage.
- Regenerate generated types rather than hand-editing generated output.
- Conversion, file-output and Web capabilities differ; check the concrete client.

## Conventions and context

Use Biome, TypeScript strict mode and ESM output.
Use Conventional Commits; follow [CONTRIBUTING.md](CONTRIBUTING.md) for releases.
Read [README.md](README.md) for core concepts and setup, and
[ARCHITECTURE.md](ARCHITECTURE.md) for decision rationale.
