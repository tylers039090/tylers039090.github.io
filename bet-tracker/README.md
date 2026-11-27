# Bet Tracker

Phone-first web app for tracking Bovada bets with live scores. Next.js (App Router) on Vercel, Supabase for the database, sign-in and realtime.

**Status: milestone 3 — live scores.**

- M1: schema with row-level security, email sign-in (magic link or 6-digit code), importer for the Claude artifact's export.
- M2: the artifact's screens in React — Daily/Futures switch, date strip (10 days back, 4 ahead), dark scoreboard with day P&L, ticket stubs grouped by tip time, futures cards (record, ranking, odds taken vs now, next game, settle date), season stats (net, record, win rate, ROI, last-14-days bars, net by sport), manual add form (singles, parlays, futures; dedupe by ticket), and Won/Lost/Push controls (tap again to undo) with two-tap delete.

- M3: live scores. A server poller reads ESPN's public scoreboard (every 30 s while a tracked game is live or tips within 15 min, every 15 min otherwise, not at all with no games), writes only changed rows to `games`, and links legs to ESPN games by team name. Phones get scores through Supabase Realtime — they never call ESPN. Each spread/total/moneyline leg shows its margin ("Gonzaga -3.5: covering by 10.5"); legs that can't be matched show **Needs game · pick it** with that day's ESPN games. If ESPN is down, the app keeps the last scores and says how old they are.

Next: milestone 4 (auto-settle on final with undo; screenshot → Claude API).

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
2. Add environment variables from `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_EMAILS`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` (never prefix these with `NEXT_PUBLIC_`).
3. Deploy, open the URL, and sign in with your email.

### 2b. Live scores (milestone 3)

1. Run `supabase/migrations/20261128000000_live_scores.sql` in the SQL Editor (after the first migration).
2. Open `supabase/setup/poller-cron.sql`, replace the URL with `https://<your-app>.vercel.app/api/poll` and the secret with your `CRON_SECRET`, and run it. Supabase then calls the poller every 30 seconds; the poller decides when ESPN is actually due.
3. Check it: `select * from public.poller_state;` should show `last_success` within a minute while games are on. To force one run: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-app>.vercel.app/api/poll?force=1"`.

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
npm test        # adapter, matching, cover line and poller cadence, against saved ESPN responses
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
| `src/lib/scoreboard.ts` | ESPN adapter: URL, typed fail-soft parser, `games` row mapping |
| `src/lib/match.ts` | Sportsbook name → ESPN team ("Saint Mary's CA" → Saint Mary's Gaels); both teams must match or the leg asks |
| `src/lib/cover.ts` | Margin vs the line from the score (used now for the live line, in M4 for grading) |
| `src/lib/live.ts` | Poller (`runPoll`: cadence, fetch, changed-row writes, linking) and save-time `linkBet` |
| `src/app/api/poll/route.ts` | Cron endpoint, `Authorization: Bearer $CRON_SECRET` |
| `supabase/setup/poller-cron.sql` | pg_cron + pg_net schedule that calls the endpoint every 30 s |
| `test/` | `node:test` suite with trimmed real ESPN responses in `test/fixtures/` |
| `src/lib/pick.ts` | Parses picks into side + line for grading (`"Gonzaga -3.5"` → Gonzaga, −3.5) |
| `scripts/import-export.ts` | Artifact export → Supabase importer |

### Schema notes vs. the brief

Same four tables as the brief, plus:

- `legs.position` — leg order inside a parlay.
- `futures_info.next_start`, `next_where` — the export has the next game's time and venue but no ESPN id yet; kept until `next_game_id` is linked.
- `games.away_short`, `home_short` — ESPN short names, used for matching and compact score lines.
- `poller_state` — one row: last run, last success, last error, whether a game is live. Drives the "scores checked 20s ago" / "ESPN isn't responding" note.
- `games.state` is constrained to `pre | in | post`; `bets.sport`, `source`, `settled_by` and `legs.result` have check constraints.
