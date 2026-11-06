# Pinned Serve schema

`docling-serve.json` is the real OpenAPI document exported from
**Docling Serve 1.7.2**, not a handwritten subset. The source commit, SHA-256,
generator and schema-relevant Python dependency versions are recorded in
`schema-provenance.json`. This pins the raw types; it does not promise SDK support
for every server feature or establish real model/conversion parity.

Regeneration from the vendored schema needs no server or network:

```sh
npm run openapi:generate
npm run openapi:check
```

To reproduce the upstream document, create an isolated Python 3.12 environment
with the package versions in the provenance file, then run
`python scripts/export-serve-schema.py`. This calls `create_app().openapi()` without
starting the application lifespan or downloading models. Optional server backends
are not SDK dependencies. The export can emit an upstream Pydantic warning about
the page-range default; the emitted schema is retained unchanged.

Alternatively, `npm run openapi:fetch -- --url http://localhost:5000` fetches
`/openapi.json` from that pinned server version. The fetcher rejects non-JSON,
non-OpenAPI and mismatched-version responses instead of silently storing YAML or
an error page. `--output PATH` writes a candidate elsewhere for review. Updating
the pin requires reviewing the schema, dependency versions and digest before
regenerating; `openapi:check` rejects unreviewed changes and stale generated types.

Upstream schema license: MIT, from
<https://github.com/docling-project/docling-serve/tree/v1.7.2>.
