# AGENTS.md

Cenora: a private, Portuguese (pt-BR) watchlist for a small friends group. pnpm monorepo, Node >=22.18, pnpm 11 (`packageManager` pins it). Run `pnpm install --frozen-lockfile` first. The `cf` CLI used by `scripts/database.mjs` lives in `apps/api/node_modules`, so scripts fail before install.

## Layout

- `apps/web`: Next.js 16 app, **statically exported** (`output: 'export'`) to `apps/web/out`. Calls the API via same-origin `/api` (`src/lib/api.ts`).
- `apps/api`: Hono Worker (`src/index.ts`) with routes in `auth.ts`, `media.ts`, `club.ts`. Non-`/api` requests go to the `ASSETS` binding, which serves `apps/web/out`. Also has a daily cron (`0 4 * * *`) that prunes sessions, attempts, and provider cache. D1 migrations live in `apps/api/migrations/`.
- `packages/shared`: `@cenora/shared` (`.` and `./import`). Consumed as TS source, no build step.
- `scripts/database.mjs`: D1 migrations, wired through `pnpm db:migrate`. Clubs are created freely in the UI; there is no bootstrap/setup code.
- `tests/`: Playwright e2e. `apps/api/test/`: Vitest integration tests.
- Working tree has many uncommitted changes (including a new `apps/web/src/components/cenora-app.tsx` and a deleted `watchlist-app.tsx`). Don't assume HEAD matches the code.

## Commands

- Dev, single server: `pnpm dev` builds the web export, then runs the Worker at http://127.0.0.1:8787.
- Dev, hot reload: `pnpm --filter @cenora/api dev` (after one web build) plus `pnpm dev:web` at http://localhost:3000. Next dev proxies `/api` to port 8787 only in dev mode.
- Validation order: `pnpm format:check` -> `pnpm typecheck` -> `pnpm test` -> `pnpm test:e2e` -> `pnpm deploy:check`.
- Single API test file: `pnpm --filter @cenora/api exec vitest run test/integration.test.ts` (add `-t "name"` to filter).
- Single e2e test: build web first (`pnpm --filter @cenora/web build`), then `pnpm exec playwright test tests/app.spec.ts -g "name"`. Playwright starts its own server on port 8788 (`reuseExistingServer: false`), so stop anything already on 8788.
- One-time browser install: `pnpm exec playwright install chromium`.
- `pnpm format` (Prettier, single quotes, width 100, trailing commas) rewrites the whole repo. Prefer `format:check` unless you intend to reformat.
- Typecheck runs `pnpm -r typecheck` across shared, api, and web.

## Gotchas

- **Stop the dev servers before rebuilding the web export on Windows.** A running asset watcher can lock `apps/web/out`.
- The web export must exist before `api dev`, `test:e2e`, or `deploy`. The Worker's assets directory is `apps/web/out`. The browser test server reads it at request time.
- Integration tests use Miniflare with a real D1 runtime, so they need no external services. The browser test server applies every `apps/api/migrations/*.sql` in sorted order. A new migration must use the next numeric prefix.
- All non-GET `/api` requests require an `Origin` header matching the request origin (or `localhost:3000` / `127.0.0.1:3000` in development). Otherwise they get 403. Integration tests must send `Origin` (the helper defaults it to `http://localhost`).
- Everything under `/api` except `/api/auth/*` and `/api/health` needs a session. Unauthenticated requests get 401.
- Local D1 uses the fixed id `11111111-1111-4111-8111-111111111111` in `cloudflare.config.ts` and `scripts/database.mjs`. Don't change it, because `database.mjs` depends on that identity.
- `apps/api/wrangler.config.ts` only configures `cf`'s static-assets builder. The real Worker config is `apps/api/cloudflare.config.ts`.
- `wrangler` is a dependency of `cf`, not a direct script. Use `cf` for all Cloudflare commands and don't call Wrangler directly.
- `pnpm db:migrate` runs locally by default. `--remote` requires `D1_DATABASE_ID`; add `--staging` for the staging database. Migration 0004 preserves an existing club and enables independent private clubs.
- Local secrets: create `apps/api/.dev.vars` from `apps/api/.dev.vars.example` (`TMDB_TOKEN`, `OMDB_KEY`). Restart the Worker after changing them. Never expose them through `NEXT_PUBLIC_`. Deploy secrets come from `.secrets.staging.json` / `.secrets.production.json`, passed with `cf deploy --secrets-file`.
- `deploy:check` (`cf deploy --dry-run`) needs no credentials. A Docker daemon diagnostic on Windows is expected and harmless.
- Never commit `.local/`, `.dev.vars*`, `.secrets.*`, `.wrangler/`, `.test/`, `.next/`, or `apps/web/out/`.

## Conventions

- User-facing text is pt-BR (errors, labels, status values). Keep new strings in Portuguese.
- Product scope is deliberately narrow: no dashboards, voting, scheduling, comments, or extra navigation.
- Every authenticated request derives its club from the server session. Scope members, lists, media, imports, exports, and administrative operations to that club; never authorize from a submitted club ID.
- Permissions: members edit only their own rating and progress. Only the owner deletes lists or manages members. Revision checks guard edits, so keep them when changing write paths.
- Catalog providers (TMDB, OMDb) are optional and failures must not block the app. Cache TTLs are documented in `README.md`.
