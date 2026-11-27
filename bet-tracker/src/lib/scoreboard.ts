/**
 * ESPN scoreboard adapter. The feed is free, keyless, unofficial and undocumented,
 * so everything that touches its shape lives here, and parsing never throws on
 * a missing field: a bad event is skipped, a bad fetch returns an error.
 *
 * https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD
 */
import { ESPN_LEAGUE } from "./leagues";
import type { Sport } from "./types";

export interface EspnTeam {
  display: string;  // "Gonzaga Bulldogs"
  short: string;    // "Gonzaga", "Mississippi St"
  abbr: string;     // "GONZ"
  location: string; // "Gonzaga", "Mississippi State"
  name: string;     // "Bulldogs"
  score: number | null;
}

export interface EspnGame {
  id: string;
  league: string;
  state: "pre" | "in" | "post";
  detail: string;   // "Final", "6:09 - 2nd Half", "11/27 - 11:00 AM EST"
  startAt: string | null;
  url: string | null;
  away: EspnTeam;
  home: EspnTeam;
}

/** Leagues the poller follows. Golf's leaderboard has a different shape and stays manual. */
export const POLLED: Partial<Record<Sport, string>> = Object.fromEntries(
  Object.entries(ESPN_LEAGUE).filter(([s]) => s !== "Golf"),
);

export function scoreboardUrl(league: string, ymd: string) {
  const extra = league === "basketball/mens-college-basketball" ? "&groups=50&limit=400" : "&limit=400";
  return `https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard?dates=${ymd.replaceAll("-", "")}${extra}`;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function parseTeam(c: Json, state: string): EspnTeam {
  const t = obj(c.team);
  const raw = str(c.score);
  const score = state === "pre" || raw === "" ? null : Number.isFinite(Number(raw)) ? Number(raw) : null;
  return {
    display: str(t.displayName),
    short: str(t.shortDisplayName) || str(t.location),
    abbr: str(t.abbreviation),
    location: str(t.location),
    name: str(t.name),
    score,
  };
}

/** Parse one scoreboard response. Unknown shapes yield an empty list, never an exception. */
export function parseScoreboard(json: unknown, league: string): EspnGame[] {
  const out: EspnGame[] = [];
  for (const ev of arr(obj(json).events)) {
    const e = obj(ev);
    const id = str(e.id);
    const comp = obj(arr(e.competitions)[0]);
    const cs = arr(comp.competitors).map(obj);
    const away = cs.find((c) => c.homeAway === "away");
    const home = cs.find((c) => c.homeAway === "home");
    const type = obj(obj(e.status).type);
    const state = str(type.state);
    if (!id || !away || !home || !["pre", "in", "post"].includes(state)) continue;

    const link = arr(e.links)
      .map(obj)
      .find((l) => arr(l.rel).includes("summary") && arr(l.rel).includes("desktop"));
    const href = str(link?.href);
    const date = str(e.date) || str(comp.date);

    out.push({
      id,
      league,
      state: state as EspnGame["state"],
      detail: str(type.shortDetail) || str(type.detail),
      startAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
      url: href.startsWith("https://www.espn.com/") ? href : null,
      away: parseTeam(away, state),
      home: parseTeam(home, state),
    });
  }
  return out;
}

export async function fetchScoreboard(
  league: string,
  ymd: string,
): Promise<{ ok: true; games: EspnGame[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(scoreboardUrl(league, ymd), {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `ESPN ${league} ${ymd}: HTTP ${res.status}` };
    return { ok: true, games: parseScoreboard(await res.json(), league) };
  } catch (e) {
    return { ok: false, error: `ESPN ${league} ${ymd}: ${e instanceof Error ? e.message : "fetch failed"}` };
  }
}

/** Row for the games table. */
export function toGameRow(g: EspnGame) {
  return {
    id: g.id,
    league: g.league,
    away: g.away.display,
    home: g.home.display,
    away_abbr: g.away.abbr,
    home_abbr: g.home.abbr,
    away_short: g.away.short,
    home_short: g.home.short,
    away_score: g.away.score,
    home_score: g.home.score,
    state: g.state,
    detail: g.detail,
    start_at: g.startAt,
    espn_url: g.url,
  };
}

/** ESPN event ids are numeric; anything else is a placeholder from the artifact import. */
export const isEspnId = (id: string | null | undefined) => !!id && /^\d+$/.test(id);

/**
 * Scoreboard dates to look on for a game starting at `startAt`. ESPN files a game
 * under its US Eastern day, so a 9:30 PM Pacific tip sits on the next day's
 * Pacific date; try Eastern first, then Pacific.
 */
export function espnDates(startAt: string | null, fallbackYmd: string): string[] {
  if (!startAt) {
    const next = new Date(`${fallbackYmd}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return [fallbackYmd, next.toISOString().slice(0, 10)];
  }
  const d = new Date(startAt);
  const et = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const pt = d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  return et === pt ? [et] : [et, pt];
}
