# Bet Tracker

Phone-first web app for tracking Bovada bets with live scores. Next.js (App Router) on Vercel, Supabase for the database, sign-in and realtime.

**Status: milestone 2 — daily slate and futures.**

- M1: schema with row-level security, email sign-in (magic link or 6-digit code), importer for the Claude artifact's export.
- M2: the artifact's screens in React — Daily/Futures switch, date strip (10 days back, 4 ahead), dark scoreboard with day P&L, ticket stubs grouped by tip time, futures cards (record, ranking, odds taken vs now, next game, settle date), season stats (net, record, win rate, ROI, last-14-days bars, net by sport), manual add form (singles, parlays, futures; dedupe by ticket), and Won/Lost/Push controls (tap again to undo) with two-tap delete.

Next: milestone 3 (ESPN poller, live scores via Realtime, cover line).

## One-time setup

### 1. Supabase

1. Create a project at supabase.com (free tier).
2. **SQL Editor** → paste and run `supabase/migrations/20261127000000_init.sql`.
   (Or with the CLI: `supabase link` then `supabase db push`.)
3. **Authentication → URL Configuration**
   - Site URL: your Vercel URL, e.g. `https://bet-tracker-xyz.vercel.app`
   - Redirect URLs: add `https://bet-tracker-xyz.vercel.app/auth/confirm` and `http://localhost:3000/auth/confirm`
4. **Authentication → Email Templates → Magic Link** — replace the body so the email carries both a link that works in any browser and a code for the Home Screen app:

   ```html
   <h2>Sign in to Bet Tracker</h2>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
   <p>Or enter this code: <strong>{{ .Token }}</strong></p>
   ```

5. After you've signed in once, turn off **Authentication → Sign In / Providers → Allow new users to sign up** so nobody else can create an account.

### 2. Vercel

1. Import this GitHub repo in Vercel and set **Root Directory** to `bet-tracker`.
2. Add environment variables from `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_EMAILS`, and `SUPABASE_SERVICE_ROLE_KEY` (server only — never `NEXT_PUBLIC_`).
3. Deploy, open the URL, and sign in with your email.

### 3. Import current bets

Keep the export file **out of the repo** (`.gitignore` blocks `*export*.json`). From `bet-tracker/`:

```bash
cp .env.example .env.local     # fill in URL, keys, IMPORT_USER_EMAIL
npm install
npx tsx scripts/import-export.ts ~/Downloads/bet-tracker-export.json --dry-run   # preview
npx tsx --env-file=.env.local scripts/import-export.ts ~/Downloads/bet-tracker-export.json
```

Rerunning is safe: bets already present (same ticket, or same date/stake/odds/pick when there's no ticket) are skipped.

> The two games in the export use the artifact's own ids (e.g. `2026-11-26-gonz-bay`), not ESPN event ids. They're imported so the Gonzaga leg shows its last score; milestone 3's linker replaces them with real ESPN games.

## Local dev

```bash
npm install
npm run dev     # http://localhost:3000
```

## Layout

| Path | What |
| --- | --- |
| `supabase/migrations/` | Tables, indexes, RLS policies, realtime publication |
| `src/proxy.ts`, `src/lib/supabase/` | Session refresh + redirect to `/login`; browser/server clients |
| `src/app/login/` | Email → link or code sign-in (server actions) |
| `src/app/auth/confirm/` | Magic-link landing route |
| `src/app/page.tsx` | Loads the signed-in user's bets and hands them to `Tracker` |
| `src/app/actions.ts` | Server actions: set status / undo, delete, add a manual bet |
| `src/components/` | `Tracker` (tabs, date strip, boards, slate), `Ticket`, `FutureCard`, `Season`, `AddBetForm` |
| `src/lib/espn.ts` | "Live on ESPN" links (game page once the poller stores it, else that day's scoreboard) |
| `src/lib/pick.ts` | Parses picks into side + line for grading (`"Gonzaga -3.5"` → Gonzaga, −3.5) |
| `scripts/import-export.ts` | Artifact export → Supabase importer |

### Schema notes vs. the brief

Same four tables as the brief, plus:

- `legs.position` — leg order inside a parlay.
- `futures_info.next_start`, `next_where` — the export has the next game's time and venue but no ESPN id yet; kept until `next_game_id` is linked.
- `games.state` is constrained to `pre | in | post`; `bets.sport`, `source`, `settled_by` and `legs.result` have check constraints.
