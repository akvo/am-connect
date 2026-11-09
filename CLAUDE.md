# AMConnect

Monorepo: `frontend/` (Next.js, TypeScript), `backend/` (FastAPI, SQLModel, Alembic),
`ckan/` and `geoserver/` (Data Service), `keycloak/` (realm config). See README.md.

## Done

- `make check` passes (lint, format, types; needs `docker compose up -d`).
- `make test` passes. A bug fix comes with a test that failed before the fix.
- `make format` applies the formatters.

## Limits (backend and frontend)

Short units are easier to review and change.

- Cyclomatic complexity 10, nesting depth 3: fewer paths to test.
- 50 lines per function, 400 per module: one screen, one purpose.
- 5 parameters: more means the function does too much.
- Types on every exported or public function; no `any`, `Any`, `@ts-ignore` or bare
  `# type: ignore`.

## Tests

- Every test asserts a result.
- Mock only external boundaries: Keycloak's HTTP API, SMTP, time. Not our own code.
- At least 80% of a PR's changed backend lines must be covered (CI, `diff-cover`).

## Writing

- Comments are short and say why, not what. Prefer clear names.
- Plain words, no invented shorthand. Vale (`make docs`) flags AI-sounding words.

## PRs

- One concern per PR; refactors apart from behavior changes.
- Over 400 changed lines: propose a split.
