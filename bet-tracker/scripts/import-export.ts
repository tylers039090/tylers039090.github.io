/**
 * Import bets from the Claude artifact's export into Supabase.
 *
 *   npx tsx --env-file=.env.local scripts/import-export.ts path/to/bet-tracker-export.json [--dry-run]
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and IMPORT_USER_EMAIL
 * (the address you signed in with — sign in once first so the user exists).
 *
 * Safe to run twice: bets with a ticket are matched on (user, ticket); bets without
 * one are matched on date + stake + odds + first pick. Matches are skipped.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ESPN_LEAGUE, toSport } from "../src/lib/leagues";
import { parsePick } from "../src/lib/pick";

// ── Export shape ─────────────────────────────────────────────────────────
interface ExportLeg {
  away?: string; home?: string; game?: string; gameId?: string;
  market?: string; odds?: number; pick: string; sport?: string; start?: string;
}
interface ExportInfo {
  market?: string; next?: string; nextStart?: string; nextWhen?: string; nextWhere?: string;
  oddsNow?: number; oddsSrc?: string; outlook?: string; rank?: string; rankNote?: string;
  record?: string; recordNote?: string; team?: string;
}
interface ExportBet {
  id: string; createdAt?: string; date: string; future?: boolean; info?: ExportInfo; infoUpdated?: string;
  legs: ExportLeg[]; odds: number; settleDate?: string; settleEvent?: string; source?: string;
  sport?: string; stake: number; start?: string; status?: string; ticket?: string; toWin: number;
  type?: string; payout?: number;
}
interface ExportGame {
  id: string; away?: string; home?: string; awayScore?: number; homeScore?: number;
  detail?: string; sport?: string; start?: string; state?: string;
}
interface ExportFile { bets: ExportBet[]; games?: ExportGame[] }

// ── Transform (pure) ─────────────────────────────────────────────────────
const blank = (s: string | undefined | null) => (s && s.trim() && s.trim() !== "—" ? s.trim() : null);
const STATES: Record<string, string> = { live: "in", in: "in", pre: "pre", scheduled: "pre", final: "post", post: "post" };
const STATUSES = ["open", "won", "lost", "push", "cashout"];

export function transform(file: ExportFile, userId: string) {
  const games = (file.games ?? []).map((g) => {
    const sport = toSport(g.sport);
    return {
      id: g.id,
      league: ESPN_LEAGUE[sport] ?? "other",
      away: blank(g.away), home: blank(g.home),
      away_score: g.awayScore ?? null, home_score: g.homeScore ?? null,
      state: STATES[(g.state ?? "").toLowerCase()] ?? null,
      detail: blank(g.detail),
      start_at: blank(g.start),
      updated_at: new Date().toISOString(),
    };
  });
  const gameIds = new Set(games.map((g) => g.id));

  const bets = file.bets.map((b) => {
    const isFuture = b.future === true || b.legs.some((l) => l.market === "Futures");
    const status = STATUSES.includes(b.status ?? "") ? b.status! : "open";
    const bet = {
      user_id: userId,
      ticket: blank(b.ticket),
      date: (isFuture && b.settleDate) || b.date,
      type: b.type === "parlay" || b.legs.length > 1 ? "parlay" : "single",
      sport: toSport(b.sport ?? b.legs[0]?.sport),
      odds: Math.round(b.odds),
      stake: b.stake,
      to_win: b.toWin,
      status,
      payout: status === "cashout" ? b.payout ?? null : null,
      settled_by: status === "open" ? null : "manual",
      is_future: isFuture,
      source: b.source === "manual" ? "manual" : "screenshot",
      created_at: b.createdAt ?? new Date().toISOString(),
    };
    const legs = b.legs.map((l, i) => {
      const { team, line } = parsePick(l.pick, l.market);
      return {
        position: i,
        pick: l.pick.trim(),
        market: blank(l.market),
        team, line,
        away: blank(l.away), home: blank(l.home),
        // Leg start, else the bet's start (futures legs can carry stale or empty dates).
        start_at: isFuture ? blank(b.start) ?? blank(l.start) : blank(l.start) ?? blank(b.start),
        game_id: l.gameId && gameIds.has(l.gameId) ? l.gameId : null,
        odds: l.odds ?? null,
        result: null,
      };
    });
    const i = b.info;
    const futures = isFuture
      ? {
          team: blank(i?.team) ?? legs[0]?.team ?? null,
          market: blank(i?.market) ?? blank(b.legs[0]?.game),
          odds_now: i?.oddsNow ?? null,
          odds_src: blank(i?.oddsSrc),
          record: blank(i?.record), record_note: blank(i?.recordNote),
          rank: blank(i?.rank), rank_note: blank(i?.rankNote),
          next_game_id: null,
          next_label: [blank(i?.next), i?.nextStart ? null : blank(i?.nextWhen)].filter(Boolean).join(" · ") || null,
          next_start: blank(i?.nextStart),
          next_where: blank(i?.nextWhere),
          settle_date: blank(b.settleDate),
          settle_event: blank(b.settleEvent),
          outlook: blank(i?.outlook),
          updated_at: blank(b.infoUpdated),
        }
      : null;
    return { exportId: b.id, bet, legs, futures };
  });

  return { games, bets };
}

// ── Load ─────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) throw new Error("Usage: import-export.ts <export.json> [--dry-run]");

  const file = JSON.parse(readFileSync(path, "utf8")) as ExportFile;

  if (dry) {
    const { games, bets } = transform(file, "00000000-0000-0000-0000-000000000000");
    console.log(JSON.stringify({ games, bets }, null, 2));
    const fut = bets.filter((b) => b.bet.is_future).length;
    console.error(`\n${bets.length} bets (${fut} futures), ${games.length} games — dry run, nothing written.`);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.IMPORT_USER_EMAIL?.toLowerCase();
  if (!url || !key || !email) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and IMPORT_USER_EMAIL.");

  const db = createClient(url, key, { auth: { persistSession: false } });

  let userId: string | undefined;
  for (let page = 1; !userId; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 200) break;
  }
  if (!userId) throw new Error("No Supabase user with IMPORT_USER_EMAIL. Sign in to the app once, then rerun.");

  const { games, bets } = transform(file, userId);

  if (games.length) {
    const { error } = await db.from("games").upsert(games, { onConflict: "id" });
    if (error) throw error;
  }

  let added = 0, skipped = 0;
  for (const { exportId, bet, legs, futures } of bets) {
    let q = db.from("bets").select("id, legs(pick)").eq("user_id", userId);
    q = bet.ticket
      ? q.eq("ticket", bet.ticket)
      : q.is("ticket", null).eq("date", bet.date).eq("stake", bet.stake).eq("odds", bet.odds);
    const { data: existing, error: findErr } = await q;
    if (findErr) throw findErr;
    const dupe = (existing ?? []).some(
      (e) => bet.ticket || (e.legs as { pick: string }[]).some((l) => l.pick === legs[0]?.pick),
    );
    if (dupe) { skipped++; continue; }

    const { data: row, error } = await db.from("bets").insert(bet).select("id").single();
    if (error) throw new Error(`bet ${exportId}: ${error.message}`);

    const { error: legErr } = await db.from("legs").insert(legs.map((l) => ({ ...l, bet_id: row.id })));
    if (legErr) throw new Error(`legs of ${exportId}: ${legErr.message}`);

    if (futures) {
      const { error: fErr } = await db.from("futures_info").insert({ ...futures, bet_id: row.id });
      if (fErr) throw new Error(`futures_info of ${exportId}: ${fErr.message}`);
    }
    added++;
  }

  console.log(`Imported ${added} bets, skipped ${skipped} already present, upserted ${games.length} games.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
