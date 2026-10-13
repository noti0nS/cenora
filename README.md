# Cenora

Cenora is a private Portuguese shelf of movies and shows for friends. Enter with an email code or with a club invite; the shelf stays the same. Anyone can create a club in the app and receive a unique private invite code. There is one screen: a **Filmes / Séries / Animes** switch over a poster shelf. Anime series have their own shelf; anime movies stay in **Filmes**. A movie opens a _session_ (status plus a draggable half-point rating dial, with friends' ratings on a shared scale). A show or anime series opens a _tracker_ (progress ring, season rail, tappable episodes, with separate personal and group progress). Changes save automatically. Custom lists are no longer shown; each club keeps a hidden default list for the API.

## Run locally

Use Node.js 22.18 or newer and pnpm 11. The lockfile pins the installed dependencies.

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Open **http://127.0.0.1:8787**. The first door is the email one: type any address, press **Enviar código**, and read the six digits in the local outbox at **http://127.0.0.1:8787/api/dev/outbox** — development captures mail instead of sending it. You can also create a club without an account: choose **Criar meu clube**, enter your name, and save the private invite code plus your recovery code. Friends open the owner's **invite link** (`Convite → Criar link de convite`) or choose **Tenho um código de convite**.

Run `pnpm db:migrate` after pulling schema changes. Existing club data, invitation codes, and sessions are preserved by the migrations. Local D1 state stays under `apps/api/.wrangler/state`. Club creation does not require a command or a pre-existing invitation.

For frontend hot reload, first build once, then use two terminals:

```powershell
pnpm --filter @cenora/api dev
```

```powershell
pnpm dev:web
```

Open **http://localhost:3000**. Next.js proxies `/api` to the local Worker. Stop the asset server before exporting the frontend again on Windows: a running asset watcher can hold the export directory open.

## Media catalog

Manual entries, lists, progress, and ratings work without external credentials. Catalog search needs a free, non-commercial [TMDB API credential](https://developer.themoviedb.org/docs/getting-started). IMDb scores additionally need an optional [OMDb key](https://www.omdbapi.com/apikey.aspx).

Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` and set:

```dotenv
TMDB_TOKEN=your_tmdb_read_access_token_or_v3_api_key
OMDB_KEY=your_optional_omdb_key
# Acesso por e-mail: obrigatório em produção; em desenvolvimento há um valor local.
AUTH_PEPPER=at_least_32_random_bytes
# Resend: sem chave em desenvolvimento, os códigos ficam no outbox local.
RESEND_API_KEY=your_resend_key
MAIL_FROM=Cenora <nao-responda@cenora.club>
# Opcional: liga a verificação do Turnstile no envio de códigos.
TURNSTILE_SECRET=your_optional_turnstile_secret
```

Restart the Worker after changing credentials. These values stay on the backend; do not prefix them with `NEXT_PUBLIC_`, except the Turnstile site key below, which is public by design.

- TMDB supplies posters, Portuguese descriptions, cast, biographies, and its own scores.
- Streaming availability is for Brazil, grouped by subscription, rental, and purchase. The link opens TMDB's availability page; provider results are not direct playback links.
- OMDb supplies IMDb scores when an IMDb ID exists. It is optional and its failures do not block the app.
- Search results are cached for one hour; details, biographies, and IMDb scores for seven days; streaming availability for one day. Stale cached data survives temporary provider failures.
- The app includes the approved TMDB logo, required TMDB notice, and JustWatch attribution.

The typographic covers are intentional fallbacks for manual entries without posters. They are not invented movie artwork or ratings.

## Import your document

Open the profile menu → **Importar títulos**. Paste a newline-separated list, or choose **Importar arquivo**. Your original screenshot titles are available privately in `imports/google-docs.json`: load that file to review all three categories, preserve order, and merge the repeated Pecadores. These personal titles are not served as a preset to other clubs.

Use **Separar Zootopia 1 e 2**, edit ambiguous names, and optionally select catalog matches by year and type. Saga Toy Story remains a manual placeholder until its individual films are selected. Unmatched entries are saved manually and can be linked later from **Conectar ao catálogo** in title details.

Imports run in small batches to stay within the free Worker/D1 request limits. Repeating an import does not duplicate identical source entries. Linking a manual entry preserves its ID, ratings, and progress. If the catalog record already exists separately, the app asks you to resolve the duplicate instead of silently merging two people's data.

The same screen also accepts newline-separated lists. The club owner can export operational data to JSON from **Configurações do clube**. Exports exclude credentials and sessions; they are portable data snapshots, not complete authentication backups.

## Access and collaboration

### Club ranking

The trophy beside the club opens a private, optional ranking, with separate movie,
show and anime leaderboards. Movies count personal watched titles; shows count
known episodes, with completed catalog seasons as a secondary metric. Monthly
registration uses Brasília's calendar (UTC−3), not an inferred watch date. Ties
share a position, and members without records have no position yet.

Migration **0011** backfills old personal checkpoints into the all-time ranking
without assigning activity dates. New personal writes update a compact episode-range
ledger atomically with the existing revision check. Corrections reduce totals;
re-marking restores the first registration without awarding repeats or moving it
to a new month. Group edits and imports do not award personal activity. Manual
shows count only known episodes, never assumed earlier seasons or completions.

Four achievements reflect current progress: first movie, completed season, five
rated watched/started titles, and a title watched by three participating active
members. A member can select one unlocked badge or opt out per club. Opting out
preserves progress but removes the member from the leaderboard and collective
summary. Achievements are not permanent rewards for corrected/removed records.
No public sharing, global XP, daily streaks or rewatch points are introduced.

### Profile pictures

Open **Meu perfil → Sua foto** to upload a picture or select one of eight original illustrated avatars. Each club profile has its own picture. PNG, JPEG, WebP, GIF, AVIF, BMP and ICO files up to 10 MB are decoded in the browser, center-cropped to a square and re-encoded as a static WebP up to 512 × 512 pixels / 512 KB. This strips source metadata and animation. SVG uploads are not accepted; the bundled preset SVGs contain only our own artwork.

Uploads live in a **private Cloudflare R2 bucket**, bound as `AVATARS`. The Worker checks the session and active club before serving a photo; there are no public R2 URLs or browser S3 credentials. Presets need no storage. Replacing or removing an upload deletes the previous object; revisions prevent concurrent devices from silently overwriting each other. Local development and tests simulate R2 without credentials.

Before deploying this feature, apply migration `0009` and create the bucket once:

```powershell
pnpm --filter @cenora/api exec cf r2 buckets create --name cenora-avatars
```

Staging uses a separate `cenora-avatars-staging` bucket. `R2_AVATARS_BUCKET` can override the bucket name when evaluating the Worker configuration. Keep R2 public access disabled; no CORS configuration is needed because uploads pass through the same-origin Worker.

Sessions keep the original cookie and browser-preference keys (`watchlist:*`), preserving existing logins, names and themes. Dark is the default theme.

- Every person has an **identity**, with or without an email. Email is one way to prove who you are, not a requirement: guests enter with a club invite and keep an identity that works across clubs.
- Anyone can create a separate private club. Each club has a unique, high-entropy invite token. The creator confirms at least one way back: an email or the identity recovery code.
- Owners can also share a club by **invite link** (`?convite=<token>`). The link never expires but can be revoked at any time, which makes the club private again; generating a new link invalidates the previous one. An optional invite password protects the whole link and can be set, changed, or removed without touching the link itself. The club code stay available as a secondary door.
- One identity can belong to several clubs and switch between them from the profile menu. Members, lists, media, ratings, imports, and administrative operations stay scoped to the active club; another club cannot read or change them, even with a known record ID.
- Sessions live 30 days without use and renew while used. Accounts expire at the 12-month mark and come back with an email code; guests do not expire by a cap — they would have no way back. Attaching an email starts that clock.
- Guests can link an email in **Meu perfil → Acesso** without losing clubs. If the address already has an account, the app offers to bring the guest clubs over and refuses (never merging silently) when both sides have a profile in the same club — the club owner resolves that.
- Recovery: generate an identity recovery code in your profile; rotating it signs other devices out. Club owners hand out a **scoped re-access code** for a member in **Configurações do clube → Quem faz parte**: it opens only that club, once, for seven days.
- Re-access sessions cannot attach an email or unlock other clubs. Use the identity recovery code or sign in with the already-linked email for full access. Linked legacy profile codes and sessions also stay limited to their original club; rotating the identity recovery code invalidates those old profile codes and sessions.
- Club codes, recovery codes, re-access codes, and session tokens are stored as hashes, and raw codes are displayed only at creation or rotation. Invite links are the deliberate exception: the token is stored so the owner can copy the link again, while an optional invite password is stored hashed.
- Members maintain shared lists and group progress, but can edit only their own rating and personal progress. Only the owner can delete lists or administer members.
- Rotating a club token revokes sessions active in that club; other clubs remain unaffected. Removing a member revokes sessions for that profile.
- A shared title has one group progress record and one tracking/rating record per member, even when it still belongs to several legacy lists.
- Revision checks protect personal and shared edits against accidental overwrites.

If a friend loses every credential, an owner can hand out a scoped re-access code. If an owner loses everything, the operator mints the same kind of code straight into D1:

```powershell
pnpm recover -- <memberId> --remote
```

The script prints the code once and stores its hash; the code opens only that profile's club. The member id appears in **Configurações do clube → Quem faz parte** (or in the `members` table).

### Email codes

- The email door sends a six-digit code, valid for 10 minutes, single use, five attempts. Codes are hashed with `AUTH_PEPPER` (HMAC-SHA256) and compared in constant time.
- Requests are limited per address, per IP, globally per day, and optionally by Turnstile. Set `TURNSTILE_SECRET` on the Worker and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` when building the web export to turn the widget on; without them the flow still works.
- In development the Worker captures messages into `mail_outbox` and exposes them at `/api/dev/outbox`; that route answers 404 outside development.
- Production sends through Resend (`RESEND_API_KEY`). Verify `cenora.club` there, add the DKIM/SPF records it shows, and start DMARC at `p=none`. The `Mailer` interface keeps a Cloudflare Email Service binding as a drop-in alternative.

## Validate

```powershell
pnpm format:check
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm deploy:check
```

`pnpm format` applies Prettier consistently. Generated artifacts, runtime state, and the lockfile are excluded from formatting.

Integration tests execute the API against a real local Worker and D1 runtime. Browser tests build the production static frontend and use a separate ephemeral database. They do not touch your local club. Screenshots are written to `artifacts/` and include desktop and 360 px mobile views. Traces are retained on failure.

The deployment dry run needs no Cloudflare credentials and does not publish the app. Cloudflare's builder currently reports a Docker daemon diagnostic on this machine even though this app has no containers; the build and dry run succeed.

## Deploy with Cloudflare `cf`

Production serves `https://cenora.club` through a Worker custom domain. The
`https://cenora.joselucas0303.workers.dev` address remains available as a fallback.

Production is configured for the `cenora` Worker and D1 database
`d2c212f4-8d89-4f78-b72e-f0a0befa6a74`. After Cloudflare authentication, run
`pnpm deploy` to publish updates. `D1_DATABASE_ID` can override the configured
production database; staging still requires its own explicit database ID.
For future production migrations, set `$env:D1_DATABASE_ID =
'd2c212f4-8d89-4f78-b72e-f0a0befa6a74'` and run `pnpm db:migrate --remote` before
deploying. Catalog credentials are optional and were not configured for the
initial publication.

All commands use the installed `cf` CLI. Its documented non-Vite builder internally delegates to Wrangler, configured by `wrangler.config.ts`; there are no direct Wrangler CLI scripts. `cf init` detected Hono but could not auto-configure this workspace, so the typed Worker configuration is supplied explicitly.

Start with staging and a **separate D1 database**:

```powershell
pnpm --filter @cenora/api exec cf auth login
pnpm --filter @cenora/api exec cf d1 create --name cenora-staging
$env:D1_DATABASE_ID = 'the_database_uuid_returned_above'
pnpm db:migrate --remote --staging
pnpm --filter @cenora/web build
pnpm --filter @cenora/api exec cf deploy --mode staging --secrets-file ../../.secrets.staging.json
```

Create the ignored `.secrets.staging.json` locally, using your actual credentials:

```json
{
  "TMDB_TOKEN": "your_tmdb_credential",
  "OMDB_KEY": "your_optional_omdb_key",
  "AUTH_PEPPER": "a_long_random_string_at_least_32_bytes",
  "RESEND_API_KEY": "your_resend_key",
  "MAIL_FROM": "Cenora <nao-responda@cenora.club>",
  "TURNSTILE_SECRET": "your_optional_turnstile_secret"
}
```

`AUTH_PEPPER` is required for the email door; without it those endpoints answer 503. The Turnstile pair is optional: set `TURNSTILE_SECRET` here and `$env:NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'the_public_site_key'` before `pnpm --filter @cenora/web build` to show the widget. Verify the sending domain (Resend: DKIM and SPF records for `cenora.club`, DMARC starting at `p=none`) before relying on real emails.

Two operational details learned on the live deploy:

- `cf deploy --secrets-file` updates only the secrets listed in the file; secrets already on the Worker (for example `TMDB_TOKEN`, `OMDB_KEY`) are preserved. The deploy summary prints just the bindings from the current configuration, so confirm the full set with `cf workers secrets list --worker cenora`.
- The Turnstile pair must always match: with `TURNSTILE_SECRET` on the Worker, `/api/auth/email/start` and `/api/auth/email/verify` reject requests without a valid token, so the web export must be built with `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The `Publish` workflow carries the public key, and `.env.local` covers local builds. A plain `curl` smoke only works while the secret is unset; after that, test the door from the browser.

Open the returned `workers.dev` address and create a club directly in the interface. Check creation, joining, recovery, cross-club privacy, the email door (read the code in the local outbox only in development; in staging ask for a real address), catalog search, progress, and imports before production.

For production, create `cenora`, set `D1_DATABASE_ID` to its different UUID, run migrations with `--remote` and without `--staging`, then deploy without `--mode staging`. Use a separate production secrets file with the same keys as staging. Environment variables are inherited from your shell; the root `.env.example` is a reference rather than an automatically loaded file.

```powershell
pnpm --filter @cenora/api exec cf d1 create --name cenora
$env:D1_DATABASE_ID = 'the_production_database_uuid'
pnpm db:migrate --remote
pnpm --filter @cenora/web build
pnpm --filter @cenora/api exec cf deploy --secrets-file ../../.secrets.production.json
```

The frontend is exported before the Worker build because `cf` does not execute custom root build scripts. API routes run through the Worker; static assets are served directly. Private data is fetched only after authentication and is not embedded in static HTML.

The free-plan target is 100,000 Worker requests/day and 10 ms CPU/request; D1 permits 5 GB per database, 5 million rows read/day, and 100,000 rows written/day (enforced as hard stops since September 2026). Workers Paid removes the D1 stops and includes 3,000 emails/month if you switch the mailer to Cloudflare Email Service. Check deployed CPU usage and errors in Cloudflare before declaring real free-tier compatibility. Local tests and dry runs do not prove live CPU usage or external API credentials.

A daily scheduled task prunes expired sessions, old authentication attempts, used or expired re-access codes, old login codes, and old provider caches. Use Cloudflare's D1 Time Travel and JSON exports for operational backup; never commit runtime state or secrets.

## Project layout

- `apps/web`: statically exported Next.js interface, local fonts, Radix controls, and Motion transitions.
- `apps/api`: Hono Worker, D1 migrations, authorization, catalog adapters, and runtime integration tests.
- `packages/shared`: TypeScript contracts, Zod validation, Portuguese status labels, and screenshot import data.
- `scripts`: local/remote D1 provisioning and the operator recovery script (`recover.mjs`).
- `tests`: end-to-end browser flows.

The gallery deliberately keeps dashboards, voting, scheduling, comments, and extra navigation out of the first release.

### GitHub publishing

The `Publish` workflow validates pull requests and publishes `main` to the production
Cloudflare Worker after formatting, type checks, API tests, browser tests, and the
deployment dry run pass. It applies pending production D1 migrations before deploying.
You can also run it manually from GitHub Actions. Production runs are serialized.

Configure the repository secret `CLOUDFLARE_API_TOKEN` with Workers Scripts Edit,
Workers Tail Read, D1 Edit, and Account Settings Read permissions for the configured
Cloudflare account. The workflow uses the pinned `cf` CLI and pnpm version.
Production secrets, including `AUTH_PEPPER`, `RESEND_API_KEY`, `MAIL_FROM`, and the
optional `TURNSTILE_SECRET`, live on the deployed Worker (dashboard or a one-time
`cf secrets` upload); the workflow deploys without a secrets file and keeps them.
Do not commit them or put them in frontend environment variables — the only public
value is `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, inlined into the static export.
