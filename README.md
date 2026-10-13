# Cenora

Cenora is a private, self-hostable movie, show, and anime shelf for small friend groups, with a Brazilian Portuguese (`pt-BR`) interface.

Anyone can create a club or join one via an invite link or code — with or without an email address. Each club shares a single poster shelf divided into **Filmes**, **Séries**, and **Animes**, while keeping personal and group tracking separate.

## Features

- **Unified shelf**: Switch between **Filmes**, **Séries**, and **Animes** (anime series have their own shelf; anime movies stay in **Filmes**). Filter by progress, toggle personal queue (**Só os meus**), or sort by recency, title, or club rating.
- **Distinct title experiences**:
  - **Movies** open a _session_ view with personal/group status, a draggable half-point rating dial (`0.5`–`10.0`), and a shared rating scale across club members.
  - **Shows and anime** open a _season tracker_ with an episode progress ring, season rail, tappable episode grid, and separate personal and group checkpoints.
- **Discovery and recommendations**:
  - **O que assistir** ranks unwatched titles already on the shelf using up to four personal favorites (`>= 7.0`) as TMDB recommendation seeds, falling back to viewing intent and club ratings when offline or unlinked.
  - **Roleta** spins a random candidate from titles the group and member have not finished yet.
  - **Novidades para você** (opt-in shelf discovery) and **Parecidos com este título** (contextual title recommendations) surface new catalog titles without sending personal history to third parties.
- **Club ranking and achievements**:
  - Optional per-club leaderboards for movies, shows, and anime, tracked by monthly activity (`America/Sao_Paulo`, UTC−3) and all-time totals.
  - Permanent three-tier achievements (**Bronze**, **Prata**, **Ouro**) across four categories: watched movies (_Repertório de cinema_), completed catalog seasons (_Créditos finais_), rated titles (_Olhar crítico_), and titles watched by at least three participating members (_Em boa companhia_). Members can equip earned badges or opt out of the leaderboard at any time.
- **Flexible, privacy-first access**:
  - **Passwordless email**: 6-digit single-use codes (10-minute TTL, HMAC-SHA256 with `AUTH_PEPPER`, constant-time verification, rate limiting, and optional Cloudflare Turnstile protection).
  - **Email-free participation**: Join or create clubs using a club code or revocable invite link (`?convite=<token>`, optionally password-protected) and keep a cross-club identity backed by a personal recovery code.
  - **Account linking and recovery**: Attach an email later, merge guest clubs into an account (refusing silently on same-club profile conflicts), or issue 7-day single-use scoped re-access codes.
- **Profile avatars**: Choose from eight bundled SVG illustrations or upload a photo (cropped and normalized client-side to a static `<= 512x512` WebP with metadata stripped, validated at the binary container level, and served from a private R2 bucket).
- **Portable data**: Batch-import lists from plain text or JSON with catalog matching and idempotent alias tracking, and export club operational data to JSON.

## Architecture

This repository is a `pnpm` monorepo targeting Cloudflare Workers, D1, and R2:

- `apps/web`: Next.js 16 frontend, statically exported (`output: 'export'`) to `apps/web/out` with local fonts (`Space Grotesk`, `Nunito Sans`), Radix UI primitives, and Motion animations.
- `apps/api`: Hono Worker (`src/index.ts`) serving `/api/*` routes and delegating static assets to the Cloudflare `ASSETS` binding. Includes a daily scheduled task (`0 4 * * *`) to prune expired sessions, login codes, rate-limit counters, used claims, and stale cache entries.
- `packages/shared`: Shared TypeScript contracts, Zod validation schemas, avatar presets, and ranking/achievement definitions (`@cenora/shared`).
- `scripts`: D1 migration runner (`scripts/database.mjs`) and emergency operator recovery tool (`scripts/recover.mjs`).
- `tests`: End-to-end Playwright browser tests (`tests/*.spec.ts`), alongside Vitest integration and unit tests in `apps/api/test/`.

## Getting Started

### Prerequisites

- **Node.js** `>= 22.18`
- **pnpm** `11` (pinned via `packageManager`)

### Local Development

Install dependencies, apply local D1 migrations, and start the development server:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Open **http://127.0.0.1:8787**.

- **Email sign-in in development**: Enter any email address and click **Enviar código**. When `RESEND_API_KEY` is not set in development, messages are captured locally and can be read at **http://127.0.0.1:8787/api/dev/outbox** (returns `404` outside development).
- **Guest flow**: Choose **Criar meu clube** (or open an invite link / **Tenho um código de convite**), enter your display name, and save the generated recovery code.

For frontend hot reload during development, build the web export once and run the API and Next.js dev server in separate terminals:

```sh
pnpm --filter @cenora/api dev
pnpm dev:web
```

Then open **http://localhost:3000** (which proxies `/api/*` to `http://localhost:8787`). On Windows, stop running dev servers before rebuilding the static export so file watchers do not lock `apps/web/out`.

## Configuration

Manual titles, ratings, progress tracking, and rankings work without external API keys. To enable catalog search, streaming availability, IMDb ratings, transactional email, or Turnstile verification locally, copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`:

```dotenv
# Optional: TMDB Read Access Token (v4) or API Key (v3) for catalog search and metadata
TMDB_TOKEN=

# Optional: OMDb API key for IMDb ratings
OMDB_KEY=

# Required in production for email login codes and invite passwords (defaults to a local fallback in development)
AUTH_PEPPER=

# Optional in development (falls back to /api/dev/outbox); required in production for email delivery via Resend
RESEND_API_KEY=
MAIL_FROM="Cenora <nao-responda@example.com>"

# Optional: Cloudflare Turnstile secret key (must be paired with NEXT_PUBLIC_TURNSTILE_SITE_KEY at web build time)
TURNSTILE_SECRET=
```

| Variable                         | Scope         | Description                                                                                                                                |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `TMDB_TOKEN`                     | Worker secret | Fetches `pt-BR` titles, posters, cast, biographies, recommendations, and Brazil streaming availability (attributed to TMDB and JustWatch). |
| `OMDB_KEY`                       | Worker secret | Fetches IMDb scores when a title has an IMDb ID.                                                                                           |
| `AUTH_PEPPER`                    | Worker secret | Secret key (`>= 32` random bytes) used to HMAC-SHA256 hash 6-digit email codes and invite link passwords.                                  |
| `RESEND_API_KEY`                 | Worker secret | Sends transactional login emails via Resend in staging/production.                                                                         |
| `MAIL_FROM`                      | Worker secret | Sender identity for transactional emails.                                                                                                  |
| `TURNSTILE_SECRET`               | Worker secret | Verifies Cloudflare Turnstile tokens on email authentication endpoints.                                                                    |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Web build env | Public Turnstile site key inlined during `pnpm --filter @cenora/web build`. Always configure alongside `TURNSTILE_SECRET`.                 |

Provider responses are cached in D1 (`provider_cache`): 1 hour for search, 24 hours for streaming availability and recommendations, and 7 days for title details, biographies, and IMDb ratings. Stale cache entries are served gracefully if an external provider is unreachable.

## Validation and Testing

Run the full verification suite in order:

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm deploy:check
```

- **API tests (`pnpm test`)**: Run against a real local Worker, D1 database, and R2 bucket via Miniflare without external network dependencies.
- **End-to-end tests (`pnpm test:e2e`)**: Build the static production frontend and run Playwright against an isolated test server on port `8788` with its own ephemeral D1 and R2 instances.

## Deployment

Deployments use the Cloudflare `cf` CLI (`apps/api/cloudflare.config.ts`).

### 1. Provision Resources

Authenticate with Cloudflare and create the D1 database and private R2 bucket for avatars:

```sh
pnpm --filter @cenora/api exec cf auth login
pnpm --filter @cenora/api exec cf d1 create --name cenora
pnpm --filter @cenora/api exec cf r2 buckets create --name cenora-avatars
```

Keep public access disabled on the R2 bucket; all avatar reads and writes are authenticated and proxied by the Worker.

### 2. Apply Migrations and Deploy

Set your Cloudflare account and database identifiers in the environment, apply remote D1 migrations, build the static frontend, and deploy the Worker:

```sh
export CLOUDFLARE_ACCOUNT_ID="<your_cloudflare_account_id>"
export D1_DATABASE_ID="<your_d1_database_uuid>"

pnpm db:migrate --remote
pnpm --filter @cenora/web build
pnpm --filter @cenora/api exec cf deploy --secrets-file ../../.secrets.production.json
```

For a staging environment, create `cenora-staging` (D1) and `cenora-avatars-staging` (R2), pass `--staging` to `pnpm db:migrate --remote --staging`, and deploy with `--mode staging`.

### 3. Operator Recovery

If a member loses access, the club owner can generate a 7-day, single-use scoped re-access code under **Clubes e participantes → Participantes → Reacesso**. If a club owner loses all credentials, an operator with D1 access can mint a scoped re-access code directly:

```sh
pnpm recover -- <memberId> --remote
```

### Continuous Integration

`.github/workflows/publish.yml` runs formatting, type checking, Vitest integration tests, Playwright browser tests, and a deployment dry-run on every push and pull request to `main`. On pushes to `main`, it applies pending remote D1 migrations and deploys the Worker using `CLOUDFLARE_API_TOKEN`.
