# Cenora

Cenora is a private Portuguese shelf of movies and shows for friends. Anyone can create a club in the app and receive a unique private invite code. There is one screen: a **Filmes / Séries** switch over a poster shelf. A movie opens a _session_ (status plus a draggable half-point rating dial, with friends' ratings on a shared scale). A show opens a _tracker_ (progress ring, season rail, tappable episodes, with separate personal and group progress). Changes save automatically. Custom lists are no longer shown; each club keeps a hidden default list for the API.

## Run locally

Use Node.js 22.18 or newer and pnpm 11. The lockfile pins the installed dependencies.

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Open **http://127.0.0.1:8787**. Enter your name and choose **Criar meu clube**. The app generates the private invite code automatically. Save it to share with friends, and save your separate personal recovery code. Friends choose **Tenho um código de convite** and enter their name and your invite code.

Run `pnpm db:migrate` after pulling schema changes. Existing club data, invitation codes, and sessions are preserved by the self-service migration. Local D1 state stays under `apps/api/.wrangler/state`. Club creation does not require a command or a pre-existing invitation.

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
```

Restart the Worker after changing credentials. These values stay on the backend; do not prefix them with `NEXT_PUBLIC_`.

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

The redesign keeps the original session-cookie and browser-preference keys (`watchlist:*`), preserving existing logins, names and themes. Dark is the default theme.

- Anyone can create a separate private club. Each club has its own unique, high-entropy invite token; each membership has a separate personal recovery code.
- Members, lists, media, ratings, imports, and administrative operations are scoped to the club authenticated by the session. Another club cannot read or change them, even with a known record ID.
- The same display name can be used in different clubs. One browser session is active at a time; use the appropriate club invitation and personal recovery code to return to a different membership.
- Names and theme preferences are remembered in localStorage. Authentication uses a 30-day HttpOnly session cookie, Secure on HTTPS.
- Reopening an existing profile on another device requires the current club token and personal recovery code. A name alone cannot reopen it.
- Club tokens, recovery codes, and session tokens are stored as SHA-256 hashes. Raw access and recovery codes are displayed only at creation/rotation.
- Members maintain shared lists and group progress, but can edit only their own rating and personal progress. Only the owner can delete lists or administer members.
- Rotating a club token revokes that club's other sessions; other clubs remain unaffected. Replacing a recovery code revokes that membership's other sessions.
- A shared title has one group progress record and one tracking/rating record per member, even when it still belongs to several legacy lists.
- Revision checks protect personal and shared edits against accidental overwrites.

If a friend loses a recovery code, the owner can generate a replacement from **Configurações do clube → Quem faz parte**. If the owner loses access, a Cloudflare administrator can reset the owner's hashed recovery code through D1; the existing club data should be preserved.

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
  "OMDB_KEY": "your_optional_omdb_key"
}
```

Open the returned `workers.dev` address and create a club directly in the interface. Check creation, joining, recovery, cross-club privacy, catalog search, progress, and imports before production.

For production, create `cenora`, set `D1_DATABASE_ID` to its different UUID, run migrations with `--remote` and without `--staging`, then deploy without `--mode staging`. Use a separate production secrets file. Environment variables are inherited from your shell; the root `.env.example` is a reference rather than an automatically loaded file.

```powershell
pnpm --filter @cenora/api exec cf d1 create --name cenora
$env:D1_DATABASE_ID = 'the_production_database_uuid'
pnpm db:migrate --remote
pnpm --filter @cenora/web build
pnpm --filter @cenora/api exec cf deploy --secrets-file ../../.secrets.production.json
```

The frontend is exported before the Worker build because `cf` does not execute custom root build scripts. API routes run through the Worker; static assets are served directly. Private data is fetched only after authentication and is not embedded in static HTML.

The free-plan target is 100,000 Worker requests/day and 10 ms CPU/request; D1 permits 500 MB per database, 5 million rows read/day, and 100,000 rows written/day. Check deployed CPU usage and errors in Cloudflare before declaring real free-tier compatibility. Local tests and dry runs do not prove live CPU usage or external API credentials.

A daily scheduled task prunes expired sessions, old authentication attempts, and old provider caches. Use Cloudflare's D1 Time Travel and JSON exports for operational backup; never commit runtime state or secrets.

## Project layout

- `apps/web`: statically exported Next.js interface, local fonts, Radix controls, and Motion transitions.
- `apps/api`: Hono Worker, D1 migrations, authorization, catalog adapters, and runtime integration tests.
- `packages/shared`: TypeScript contracts, Zod validation, Portuguese status labels, and screenshot import data.
- `scripts`: local/remote D1 provisioning.
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
Optional catalog credentials remain managed through the production secrets file;
do not commit them or put them in frontend environment variables.
