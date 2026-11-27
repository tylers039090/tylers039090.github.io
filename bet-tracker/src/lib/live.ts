import "server-only";
import type { Admin } from "./supabase/admin";
import {
  espnDates,
  fetchScoreboard,
  isEspnId,
  POLLED,
  toGameRow,
  type EspnGame,
} from "./scoreboard";
import { matchGame, matchTeam } from "./match";
import { localYmd, shiftYmd } from "./format";
import type { Sport } from "./types";

// ── Scoreboard fetching with a per-run cache ─────────────────────────────

type Fetch = typeof fetchScoreboard;

export function scoreboards(fetcher: Fetch = fetchScoreboard) {
  const cache = new Map<string, ReturnType<Fetch>>();
  const errors: string[] = [];
  const get = (league: string, ymd: string) => {
    const k = `${league}|${ymd}`;
    if (!cache.has(k)) {
      cache.set(
        k,
        fetcher(league, ymd).then((r) => {
          if (!r.ok) errors.push(r.error);
          return r;
        }),
      );
    }
    return cache.get(k)!;
  };
  /** All games for a league across several dates (failed dates contribute nothing). */
  const games = async (league: string, dates: string[]) => {
    const rs = await Promise.all(dates.map((d) => get(league, d)));
    const seen = new Map<string, EspnGame>();
    rs.forEach((r) => r.ok && r.games.forEach((g) => seen.set(g.id, g)));
    return [...seen.values()];
  };
  return { get, games, errors, fetched: () => cache.size };
}

const asTeams = (g: EspnGame) => ({
  id: g.id,
  away: { display: g.away.display, short: g.away.short, abbr: g.away.abbr, location: g.away.location, name: g.away.name },
  home: { display: g.home.display, short: g.home.short, abbr: g.home.abbr, location: g.home.location, name: g.home.name },
  g,
});

export interface LinkableLeg {
  team: string | null;
  away: string | null;
  home: string | null;
  start_at: string | null;
}

/** Find a leg's ESPN game: both teams when the leg names them, else the picked team. */
export function findLegGame(leg: LinkableLeg, candidates: EspnGame[]): EspnGame | null {
  const teams = candidates.map(asTeams);
  let hit = leg.away && leg.home ? matchGame(leg.away, leg.home, teams) : null;
  if (!hit && !(leg.away && leg.home) && leg.team && leg.team !== "Over" && leg.team !== "Under") {
    hit = matchTeam(leg.team, teams);
  }
  // Same matchup twice in the window (rare): take the one nearest the leg's start.
  if (hit && leg.start_at) {
    const twins = teams.filter(
      (t) => t.away.display === hit!.away.display && t.home.display === hit!.home.display,
    );
    if (twins.length > 1) {
      const at = Date.parse(leg.start_at);
      twins.sort((a, z) => Math.abs(Date.parse(a.g.startAt ?? "") - at) - Math.abs(Date.parse(z.g.startAt ?? "") - at));
      hit = twins[0];
    }
  }
  return hit?.g ?? null;
}

async function upsertGames(admin: Admin, games: EspnGame[]) {
  if (!games.length) return null;
  const now = new Date().toISOString();
  const { error } = await admin.from("games").upsert(games.map((g) => ({ ...toGameRow(g), updated_at: now })), { onConflict: "id" });
  return error?.message ?? null;
}

/** Remove artifact placeholder games ("2026-11-26-gonz-bay") nothing points at any more. */
async function dropPlaceholders(admin: Admin, ids: string[]) {
  for (const id of new Set(ids.filter((x) => !isEspnId(x)))) {
    const [{ count: legs }, { count: fut }] = await Promise.all([
      admin.from("legs").select("id", { count: "exact", head: true }).eq("game_id", id),
      admin.from("futures_info").select("bet_id", { count: "exact", head: true }).eq("next_game_id", id),
    ]);
    if (!legs && !fut) await admin.from("games").delete().eq("id", id);
  }
}

// ── Save-time linking ────────────────────────────────────────────────────

/** Link every unlinked leg of one bet to its ESPN game. Returns how many it linked. */
export async function linkBet(admin: Admin, betId: string): Promise<number> {
  const { data: bet } = await admin
    .from("bets")
    .select("id, sport, date, is_future, legs(id, team, away, home, start_at, game_id)")
    .eq("id", betId)
    .single();
  if (!bet || bet.is_future) return 0;
  const league = POLLED[bet.sport as Sport];
  if (!league) return 0;

  const sb = scoreboards();
  let linked = 0;
  const old: string[] = [];
  for (const leg of bet.legs as (LinkableLeg & { id: string; game_id: string | null })[]) {
    if (isEspnId(leg.game_id)) continue;
    const game = findLegGame(leg, await sb.games(league, espnDates(leg.start_at, bet.date)));
    if (!game) continue;
    if (await upsertGames(admin, [game])) continue;
    const { error } = await admin.from("legs").update({ game_id: game.id, start_at: game.startAt ?? leg.start_at }).eq("id", leg.id);
    if (!error) {
      linked++;
      if (leg.game_id) old.push(leg.game_id);
    }
  }
  await dropPlaceholders(admin, old);
  return linked;
}

// ── The poller ───────────────────────────────────────────────────────────

const MIN = 60_000;
export const IDLE_EVERY = 15 * MIN;
export const HOT_LEAD = 15 * MIN;

interface OpenLeg extends LinkableLeg {
  id: string;
  game_id: string | null;
  bets: { sport: string; date: string };
}
interface OpenFuture {
  bet_id: string;
  team: string | null;
  next_game_id: string | null;
  next_start: string | null;
  bets: { sport: string };
}
interface GameRow {
  id: string;
  league: string;
  state: string | null;
  start_at: string | null;
  away_score: number | null;
  home_score: number | null;
  detail: string | null;
  espn_url: string | null;
  away_short: string | null;
}

export interface PollResult {
  ran: boolean;
  reason: string;
  hot: boolean;
  tracked: number;
  fetched: number;
  changed: number;
  linked: number;
  final: string[];   // games that went final this run (milestone 4 grades these)
  errors: string[];
}

/** One poller tick. Decides whether ESPN is due, fetches, writes changed games, links legs. */
export async function runPoll(admin: Admin, opts: { now?: Date; force?: boolean; fetcher?: Fetch } = {}): Promise<PollResult> {
  const now = opts.now ?? new Date();
  const t = now.getTime();
  const today = localYmd(now);
  const inWindow = (iso: string | null) => !!iso && Date.parse(iso) >= t - 18 * 60 * MIN && Date.parse(iso) <= t + 30 * 60 * MIN;

  const [legsRes, futRes, stateRes] = await Promise.all([
    admin
      .from("legs")
      .select("id, team, away, home, start_at, game_id, bets!inner(sport, date, status, is_future)")
      .is("result", null)
      .eq("bets.status", "open")
      .eq("bets.is_future", false),
    admin
      .from("futures_info")
      .select("bet_id, team, next_game_id, next_start, bets!inner(sport, status)")
      .eq("bets.status", "open"),
    admin.from("poller_state").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (legsRes.error || futRes.error) {
    throw new Error(legsRes.error?.message ?? futRes.error?.message);
  }
  const legs = (legsRes.data ?? []) as unknown as OpenLeg[];
  const futures = (futRes.data ?? []) as unknown as OpenFuture[];
  const state = stateRes.data as { last_run: string | null; hot: boolean; tracked: number } | null;

  const linkedIds = [
    ...legs.map((l) => l.game_id),
    ...futures.map((f) => f.next_game_id),
  ].filter(isEspnId) as string[];
  const { data: gameData } = linkedIds.length
    ? await admin.from("games").select("*").in("id", [...new Set(linkedIds)])
    : { data: [] };
  const known = new Map(((gameData ?? []) as GameRow[]).map((g) => [g.id, g]));

  // What to fetch: (league, ESPN date) pairs.
  const pairs = new Map<string, { league: string; ymd: string }>();
  const want = (league: string | undefined, dates: string[]) =>
    league && dates.forEach((ymd) => pairs.set(`${league}|${ymd}`, { league, ymd }));

  const toLink: OpenLeg[] = [];
  let hot = false;
  const soon = (iso: string | null) => !!iso && Date.parse(iso) <= t + HOT_LEAD && Date.parse(iso) >= t - 6 * 60 * MIN;

  for (const leg of legs) {
    const league = POLLED[leg.bets.sport as Sport];
    if (!league) continue;
    const g = isEspnId(leg.game_id) ? known.get(leg.game_id!) : undefined;
    if (g) {
      if (g.state === "post") continue;
      want(g.league, espnDates(g.start_at, leg.bets.date));
      if (g.state === "in" || soon(g.start_at)) hot = true;
    } else {
      const inRange = leg.start_at ? inWindow(leg.start_at) : leg.bets.date >= shiftYmd(today, -1) && leg.bets.date <= shiftYmd(today, 1);
      if (!inRange) continue;
      toLink.push(leg);
      want(league, espnDates(leg.start_at, leg.bets.date));
      if (soon(leg.start_at)) hot = true;
    }
  }
  const futToLink: OpenFuture[] = [];
  for (const f of futures) {
    const league = POLLED[f.bets.sport as Sport];
    if (!league) continue;
    const g = isEspnId(f.next_game_id) ? known.get(f.next_game_id!) : undefined;
    if (g) {
      if (g.state === "post") continue;
      want(g.league, espnDates(g.start_at, today));
      if (g.state === "in" || soon(g.start_at)) hot = true;
    } else if (f.next_start && inWindow(f.next_start)) {
      futToLink.push(f);
      want(league, espnDates(f.next_start, today));
    }
  }

  const base = { hot, tracked: pairs.size, fetched: 0, changed: 0, linked: 0, final: [] as string[], errors: [] as string[] };

  if (!pairs.size) {
    if (state?.hot || state?.tracked) await admin.from("poller_state").update({ hot: false, tracked: 0 }).eq("id", 1);
    return { ran: false, reason: "no games to follow", ...base };
  }
  const since = state?.last_run ? t - Date.parse(state.last_run) : Infinity;
  if (!opts.force && !hot && since < IDLE_EVERY - 10_000) {
    return { ran: false, reason: `idle; next ESPN check in ${Math.ceil((IDLE_EVERY - since) / MIN)} min`, ...base };
  }

  // Fetch.
  const sb = scoreboards(opts.fetcher);
  await Promise.all([...pairs.values()].map((p) => sb.get(p.league, p.ymd)));
  const byLeague = async (league: string, dates: string[]) => sb.games(league, dates);
  const all = new Map<string, EspnGame>();
  for (const p of pairs.values()) (await byLeague(p.league, [p.ymd])).forEach((g) => all.set(g.id, g));

  // 1. Changed scores on games we already follow.
  const write = new Map<string, EspnGame>();
  const final: string[] = [];
  for (const [id, row] of known) {
    const g = all.get(id);
    if (!g) continue;
    const r = toGameRow(g);
    const changed =
      r.state !== row.state || r.away_score !== row.away_score || r.home_score !== row.home_score ||
      r.detail !== row.detail || r.start_at !== row.start_at || (r.espn_url ?? null) !== row.espn_url ||
      r.away_short !== row.away_short;
    if (changed) write.set(id, g);
    if (r.state === "post" && row.state !== "post") final.push(id);
  }

  // 2. Link legs that have no ESPN game yet.
  const legLinks: { id: string; game: EspnGame; old: string | null }[] = [];
  for (const leg of toLink) {
    const league = POLLED[leg.bets.sport as Sport]!;
    const game = findLegGame(leg, await byLeague(league, espnDates(leg.start_at, leg.bets.date)));
    if (game) {
      legLinks.push({ id: leg.id, game, old: leg.game_id });
      if (!known.has(game.id)) write.set(game.id, game);
    }
  }
  // 3. Link futures teams to their next game.
  const futLinks: { bet_id: string; game: EspnGame; old: string | null }[] = [];
  for (const f of futToLink) {
    const league = POLLED[f.bets.sport as Sport]!;
    const hit = matchTeam(f.team, (await byLeague(league, espnDates(f.next_start, today))).map(asTeams));
    if (hit) {
      futLinks.push({ bet_id: f.bet_id, game: hit.g, old: f.next_game_id });
      if (!known.has(hit.g.id)) write.set(hit.g.id, hit.g);
    }
  }

  const errors = [...sb.errors];
  const upErr = await upsertGames(admin, [...write.values()]);
  if (upErr) errors.push(`games upsert: ${upErr}`);
  else {
    for (const l of legLinks) {
      const { error } = await admin.from("legs").update({ game_id: l.game.id, start_at: l.game.startAt }).eq("id", l.id);
      if (error) errors.push(`link leg ${l.id}: ${error.message}`);
    }
    for (const f of futLinks) {
      const { error } = await admin
        .from("futures_info")
        .update({ next_game_id: f.game.id, next_start: f.game.startAt })
        .eq("bet_id", f.bet_id);
      if (error) errors.push(`link future ${f.bet_id}: ${error.message}`);
    }
    await dropPlaceholders(admin, [...legLinks, ...futLinks].map((x) => x.old).filter((x): x is string => !!x));
  }

  // Re-check heat with fresh states, so the next tick knows whether ESPN is due.
  const fresh = [...all.values()].filter((g) => known.has(g.id) || legLinks.some((l) => l.game.id === g.id) || futLinks.some((f) => f.game.id === g.id));
  hot = fresh.some((g) => g.state === "in" || (g.state === "pre" && soon(g.startAt)));

  const nowIso = now.toISOString();
  await admin
    .from("poller_state")
    .update({
      last_run: nowIso,
      hot,
      tracked: fresh.filter((g) => g.state !== "post").length,
      ...(errors.length ? { last_error: errors.join("; ").slice(0, 500), last_error_at: nowIso } : { last_success: nowIso }),
    })
    .eq("id", 1);

  return {
    ran: true,
    reason: hot ? "live" : "idle check",
    hot,
    tracked: fresh.length,
    fetched: sb.fetched(),
    changed: write.size,
    linked: legLinks.length + futLinks.length,
    final,
    errors,
  };
}
