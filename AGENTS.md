# AGENTS.md

Cenora: a private, Portuguese (`pt-BR`) movie, show, and anime shelf for small friend groups. `pnpm` monorepo, Node `>= 22.18`, `pnpm 11` (`packageManager` pins it). Run `pnpm install --frozen-lockfile` first. The `cf` CLI used by `scripts/database.mjs` lives in `apps/api/node_modules`, so scripts fail before install.

## Layout

- `apps/web`: Next.js 16 app, **statically exported** (`output: 'export'`) to `apps/web/out`. Calls the API via same-origin `/api` (`src/lib/api.ts`).
- `apps/api`: Hono Worker (`src/index.ts`) with routes in `auth.ts`, `avatars.ts`, `media.ts` (recommendations in `recommendations.ts`, catalog adapters in `providers.ts`), `club.ts`, and `ranking.ts` (`achievements.ts`), plus a `mailer.ts` provider layer and an optional local outbox (`/api/dev/outbox`). Non-`/api` requests go to the `ASSETS` binding, which serves `apps/web/out`. Also has a daily cron (`0 4 * * *`) that prunes sessions, attempts, login codes, used claims, outbox entries, and provider cache. D1 migrations live in `apps/api/migrations/`.
- `packages/shared`: `@cenora/shared` (`src/index.ts`, re-exporting `avatars.ts` and `ranking.ts`). Consumed as TS source, no build step.
- `scripts/database.mjs`: D1 migrations, wired through `pnpm db:migrate`. `scripts/recover.mjs`: operator-emergency scoped re-access code (`pnpm recover -- <memberId> [--remote|--staging]`).
- `tests/`: Playwright e2e (`app.spec.ts`, `avatars.spec.ts`, `ranking.spec.ts`, `responsive.spec.ts`, `turnstile.spec.ts`). `apps/api/test/`: Vitest integration and unit tests (`integration.test.ts`, `mailer.test.ts`, `ranking.test.ts`, `recommendations.test.ts`).
- UI is one unified screen in `apps/web/src/components/cenora-app.tsx` (**Filmes / Séries / Animes** switch; anime series have their own shelf while anime movies stay in Filmes). Landing page is `landing.tsx`, access/email/recovery is `access.tsx`, account and club administration is `settings.tsx` and `clubs-panel.tsx` (Turnstile helper in `lib/turnstile.ts`, avatars in `avatar-picker.tsx` / `lib/avatar.ts`). Movie detail is `movie-session.tsx` (rating dial in `rating-dial.tsx`), show/anime detail is `show-tracker.tsx`, both inside `title-stage.tsx` (with `title-recommendations.tsx`). Shelf recommendations/discovery are in `recommendations.tsx`, `discovery-section.tsx`, and `roleta.tsx`; club leaderboards and achievements are in `club-ranking.tsx` and `achievement-collection.tsx`. Tracking autosaves via `lib/tracking.ts`. Styles: `globals.css`, `cenora.css`, `landing.css`, `avatars.css`, and `ranking.css`. Avoid class names that match Tailwind utilities (e.g. `.ring`). `ensureList` in the app uses the club's first list behind the scenes. `/media` accepts `kind` (`movie` | `tv` | `anime`), and `/media/counts` returns per-kind totals.

## Commands

- Dev, single server: `pnpm dev` builds the web export, then runs the Worker at `http://127.0.0.1:8787`.
- Dev, hot reload: `pnpm --filter @cenora/api dev` (after one web build) plus `pnpm dev:web` at `http://localhost:3000`. Next dev proxies `/api` to port `8787` only in dev mode.
- Validation order: `pnpm format:check` -> `pnpm typecheck` -> `pnpm test` -> `pnpm test:e2e` -> `pnpm deploy:check`.
- Single API test file: `pnpm --filter @cenora/api exec vitest run test/integration.test.ts` (add `-t "name"` to filter).
- Single e2e test: build web first (`pnpm --filter @cenora/web build`), then `pnpm exec playwright test tests/app.spec.ts -g "name"`. Playwright starts its own server on port `8788` (`reuseExistingServer: false`), so stop anything already on `8788`.
- One-time browser install: `pnpm exec playwright install chromium`.
- `pnpm format` (Prettier, single quotes, width 100, trailing commas) rewrites the whole repo. Prefer `format:check` unless you intend to reformat.
- Typecheck runs `pnpm -r typecheck` across `shared`, `api`, and `web`.

## Gotchas

- **Stop the dev servers before rebuilding the web export on Windows.** A running asset watcher can lock `apps/web/out`.
- The web export must exist before `api dev`, `test:e2e`, or `deploy`. The Worker's assets directory is `apps/web/out`. The browser test server reads it at request time.
- Integration tests use Miniflare with real D1 and R2 (`AVATARS`) runtimes, so they need no external services. The browser test server (`apps/api/test/browser-server.mjs`) applies every `apps/api/migrations/*.sql` in sorted order (currently through `0013_achievement_levels.sql`). A new migration must use the next numeric prefix.
- All non-GET `/api` requests require an `Origin` header matching the request origin (or `localhost:3000` / `127.0.0.1:3000` in development). Otherwise they get `403`. Body size is capped at 128 KB except `PUT /api/auth/profile/avatar` (`AVATAR_UPLOAD_BYTES`, 512 KB). Integration tests must send `Origin` (the helper defaults it to `http://localhost`).
- Everything under `/api` except `/api/auth/*`, `/api/dev/outbox` (development only), and `/api/health` needs an active club member session. Unauthenticated requests get `401`.
- Profile avatars (`0009`): preset SVG avatars require no storage; uploaded photos are decoded/cropped client-side to static WebP (`<= 512x512`, `<= 512 KB`, no SVG uploads) and stored in a private R2 bucket bound as `AVATARS` (`cenora-avatars` in prod, `cenora-avatars-staging` in staging, override via `R2_AVATARS_BUCKET`). All avatar reads/writes go through the authenticated Worker with revision checks; never expose public R2 URLs.
- Club ranking and achievements (`0011`–`0013`): monthly activity uses the Brasília calendar (`America/Sao_Paulo`, UTC-3), recorded atomically in an episode-range ledger on personal writes (group edits and imports never award personal activity). Corrections reduce totals; re-marking restores original dates without awarding repeats. Achievements (bronze/silver/gold) are awarded atomically and never revoked, even if a member opts out of the leaderboard.
- Local D1 uses the fixed id `11111111-1111-4111-8111-111111111111` in `cloudflare.config.ts` and `scripts/database.mjs`. Don't change it, because `database.mjs` depends on that identity.
- `apps/api/wrangler.config.ts` only configures `cf`'s static-assets builder. The real Worker config is `apps/api/cloudflare.config.ts`.
- `wrangler` is a dependency of `cf`, not a direct script. Use `cf` for all Cloudflare commands and don't call Wrangler directly.
- `pnpm db:migrate` runs locally by default. `--remote` requires `D1_DATABASE_ID`; add `--staging` for the staging database.
- Local secrets: create `apps/api/.dev.vars` from `apps/api/.dev.vars.example` (`TMDB_TOKEN`, `OMDB_KEY`, `AUTH_PEPPER`, `RESEND_API_KEY`, `MAIL_FROM`, `TURNSTILE_SECRET`). Without `RESEND_API_KEY`, development captures mail into `mail_outbox` and exposes it at `/api/dev/outbox` (`404` elsewhere). `AUTH_PEPPER` falls back to a development-only value; production answers `503` without it. `TURNSTILE_SECRET` is optional and pairs with the public `NEXT_PUBLIC_TURNSTILE_SITE_KEY` at web build time. Never expose backend secrets through `NEXT_PUBLIC_`.
- Sessions belong to an identity (`users`) and may carry a scoped club (`scope_member_id`) or no active club at all. Sliding renewal: 30 days idle; the 12-month cap applies only to identities **with** an email — guests and identity-less profiles never hard-expire. Attaching an email resets the session clock.
- Scoped sessions (from a re-access code or a linked legacy profile credential) may not switch clubs, attach an email, rotate the recovery code, sign out other devices, create/join clubs, or merge identities. Only a fresh login with the identity recovery code or its already-linked email grants full access. Legacy profile sessions gain identity information but remain scoped when linked; rotating identity recovery invalidates their old profile codes and sessions. Keep those refusals when touching auth paths.
- Identity merges never happen silently: a conflict (both identities hold an active profile in the same club) refuses with `MERGE_CONFLICT` and the club owner removes one profile. Removed profiles retain their history without blocking linking or merging. Club owners issue a scoped `claim` for members with an identity rather than regenerating profile credentials.
- Email codes are six digits hashed with `AUTH_PEPPER` (HMAC-SHA256); high-entropy codes (recovery, re-access) use plain SHA-256. Limits live in `hit()` (D1) plus the optional `RL_AUTH` binding — configured only outside `development` because Miniflare does not simulate it. Never log codes, tokens, or email bodies.
- Turnstile is a matched pair: `TURNSTILE_SECRET` on the Worker (`.dev.vars` locally, Worker secret in production) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` at web build time (`.env.local` locally, the `Publish` workflow carries the public key). With the secret set, the email endpoints reject requests without a valid token, so never set one without the other.
- `cf deploy --secrets-file` updates only the listed secrets and preserves the rest (for example `TMDB_TOKEN`), but the deploy summary omits pre-existing ones — confirm with `cf workers secrets list --worker <name>`.
- Tests read codes from `mail_outbox` (`outboxCode`) and log in with the `loginByEmail` helper. The dev outbox route must stay unreachable outside development; there is an integration test for it.
- Never commit `.local/`, `.dev.vars*`, `.secrets.*`, `.wrangler/`, `.cloudflare/`, `.test/`, `.next/`, `artifacts/`, or `apps/web/out/`.

## Conventions

- User-facing text is `pt-BR` (errors, labels, status values). Keep new strings in Portuguese, including transactional emails (subject `"Seu código de acesso"`).
- Email is optional by design: never require it to participate. One identity per person; recovery codes are per identity, so do not reintroduce per-club credentials for new profiles.
- Product scope is deliberately narrow: no dashboards, voting, scheduling, comments, or extra navigation. Movies and shows must stay distinct experiences (session vs. season tracker).
- Every authenticated request derives its club from the server session. Scope members, lists, media, imports, exports, and administrative operations to that club; never authorize from a submitted club ID.
- Permissions: members edit only their own rating and progress. Only the owner deletes lists, removes titles, or manages members. Revision checks guard edits, so keep them when changing write paths.
- Invite links (`?convite=<token>`) are the deliberate exception to the hashed-credentials rule: the token lives in clear text in `club_invites` so the owner can copy the link again. An optional invite password is hashed (`AUTH_PEPPER` HMAC keyed by `club_id`, so it survives rotating the link). Revoking the row makes the club private again; the older club code still works through `POST /auth/join`.
- Catalog providers (TMDB, OMDb) are optional and failures must not block the app. Cache TTLs are documented in `README.md`.
