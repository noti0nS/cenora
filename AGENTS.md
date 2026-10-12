# AGENTS.md

Cenora: a private, Portuguese (pt-BR) movie and show shelf for a small friends group. pnpm monorepo, Node >=22.18, pnpm 11 (`packageManager` pins it). Run `pnpm install --frozen-lockfile` first. The `cf` CLI used by `scripts/database.mjs` lives in `apps/api/node_modules`, so scripts fail before install.

## Layout

- `apps/web`: Next.js 16 app, **statically exported** (`output: 'export'`) to `apps/web/out`. Calls the API via same-origin `/api` (`src/lib/api.ts`).
- `apps/api`: Hono Worker (`src/index.ts`) with routes in `auth.ts`, `media.ts`, `club.ts`, a `mailer.ts` provider layer, and an optional local outbox (`/api/dev/outbox`). Non-`/api` requests go to the `ASSETS` binding, which serves `apps/web/out`. Also has a daily cron (`0 4 * * *`) that prunes sessions, attempts, login codes, used claims, and provider cache. D1 migrations live in `apps/api/migrations/`.
- `packages/shared`: `@cenora/shared` (`.` and `./import`). Consumed as TS source, no build step.
- `scripts/database.mjs`: D1 migrations, wired through `pnpm db:migrate`. `scripts/recover.mjs`: operator-emergency scoped re-access code (`pnpm recover -- <memberId> [--remote|--staging]`). Clubs are created freely in the UI; there is no bootstrap/setup code.
- `tests/`: Playwright e2e. `apps/api/test/`: Vitest integration tests.
- UI is one unified screen in `apps/web/src/components/cenora-app.tsx` (Filmes/Séries switch). Access/email/recovery is `access.tsx`, account and club administration is `settings.tsx` (Turnstile helper in `lib/turnstile.ts`). Movie detail is `movie-session.tsx` (rating dial in `rating-dial.tsx`), show detail is `show-tracker.tsx`, both inside `title-stage.tsx`. Tracking autosaves via `lib/tracking.ts`. Styles: `globals.css` (tokens, shared primitives, access/settings/import) plus `cenora.css`. Avoid class names that match Tailwind utilities (e.g. `.ring`). The UI no longer exposes lists; `ensureList` in the app uses the club's first list behind the scenes. `/media` accepts `kind`, and `/media/counts` returns per-kind totals.

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
- `pnpm db:migrate` runs locally by default. `--remote` requires `D1_DATABASE_ID`; add `--staging` for the staging database. Migration 0004 split legacy clubs into free clubs; 0005 added identities (`users`), email login codes, and the identity sessions table; 0006 added `member_claims` (scoped re-access). Existing sessions and recovery codes keep working across all of them.
- Local secrets: create `apps/api/.dev.vars` from `apps/api/.dev.vars.example` (`TMDB_TOKEN`, `OMDB_KEY`, `AUTH_PEPPER`, `RESEND_API_KEY`, `MAIL_FROM`, `TURNSTILE_SECRET`). Without `RESEND_API_KEY`, development captures mail into `mail_outbox` and exposes it at `/api/dev/outbox` (404 elsewhere). `AUTH_PEPPER` falls back to a development-only value; production answers 503 without it. `TURNSTILE_SECRET` is optional and pairs with the public `NEXT_PUBLIC_TURNSTILE_SITE_KEY` at web build time. Never expose the others through `NEXT_PUBLIC_`.
- Sessions belong to an identity (`users`) and may carry a scoped club (`scope_member_id`) or no active club at all. Sliding renewal: 30 days idle; the 12-month cap applies only to identities **with** an email — guests and identity-less profiles never hard-expire. Attaching an email resets the session clock.
- Scoped sessions (from a re-access code) may not switch clubs, rotate the recovery code, sign out other devices, create/join clubs, or merge identities. Attaching a verified email (or a fresh session from the recovery code) unlocks them. Keep those refusals when touching auth paths.
- Identity merges never happen silently: a conflict (both identities hold a profile in the same club) refuses with `MERGE_CONFLICT` and the club owner removes one profile. Club owners can no longer regenerate credentials for members with an identity; they issue a scoped `claim` instead.
- Email codes are six digits hashed with `AUTH_PEPPER` (HMAC-SHA256); high-entropy codes (recovery, re-access) use plain SHA-256. Limits live in `hit()` (D1) plus the optional `RL_AUTH` binding — configured only outside `development` because Miniflare does not simulate it. Never log codes, tokens, or email bodies.
- Tests read codes from `mail_outbox` (`outboxCode`) and log in with the `loginByEmail` helper. The dev outbox route must stay unreachable outside development; there is an integration test for it.
- `deploy:check` (`cf deploy --dry-run`) needs no credentials. A Docker daemon diagnostic on Windows is expected and harmless.
- Never commit `.local/`, `.dev.vars*`, `.secrets.*`, `.wrangler/`, `.test/`, `.next/`, or `apps/web/out/`.

## Conventions

- User-facing text is pt-BR (errors, labels, status values). Keep new strings in Portuguese, including transactional emails (subject "Seu código de acesso").
- Email is optional by design: never require it to participate. One identity per person; recovery codes are per identity, so do not reintroduce per-club credentials for new profiles.
- Product scope is deliberately narrow: no dashboards, voting, scheduling, comments, or extra navigation. Movies and shows must stay distinct experiences (session vs. season tracker).
- Every authenticated request derives its club from the server session. Scope members, lists, media, imports, exports, and administrative operations to that club; never authorize from a submitted club ID.
- Permissions: members edit only their own rating and progress. Only the owner deletes lists or manages members. Revision checks guard edits, so keep them when changing write paths.
- Catalog providers (TMDB, OMDb) are optional and failures must not block the app. Cache TTLs are documented in `README.md`.
