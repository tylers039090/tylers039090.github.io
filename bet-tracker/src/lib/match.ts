/**
 * Matching sportsbook team names ("Gonzaga", "Saint Mary's CA", "Mississippi State")
 * to ESPN teams, without depending on exact strings.
 */

export interface TeamNames {
  display: string;
  short?: string | null;
  abbr?: string | null;
  location?: string | null;
  name?: string | null;
}

const STATES = new Set(
  "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy".split(" "),
);
/** Sportsbook name → ESPN name, after canonicalizing. */
const ALIASES: Record<string, string> = {
  mississippi: "ole miss",
  "miami fl": "miami",
  "miami florida": "miami",
  "miami ohio": "miami oh",
  connecticut: "uconn",
  "southern california": "usc",
  "louisiana state": "lsu",
  "central florida": "ucf",
  "brigham young": "byu",
  "southern methodist": "smu",
  "texas christian": "tcu",
  "nevada las vegas": "unlv",
  "virginia commonwealth": "vcu",
  "pittsburgh": "pitt",
};
const GENERIC = new Set(["state", "saint", "st", "university", "college", "of", "the"]);

export function canon(s: string | null | undefined): string {
  let t = (s ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = t.split(" ");
  // "Saint Mary's CA" → "saint marys"; keep single words like "Ohio".
  if (parts.length >= 2 && STATES.has(parts[parts.length - 1])) parts.pop();
  // "Mississippi St" → "mississippi state"
  if (parts.length >= 2 && parts[parts.length - 1] === "st") parts[parts.length - 1] = "state";
  t = parts.join(" ");
  return ALIASES[t] ?? t;
}

const tokens = (s: string) => s.split(" ").filter(Boolean);

/** 0 … 1: how well a sportsbook name fits one ESPN team. */
export function teamScore(query: string | null | undefined, team: TeamNames): number {
  const q = canon(query);
  if (!q) return 0;
  const names = [team.abbr, team.location, team.short, team.display, team.name].map(canon).filter(Boolean);
  if (names.includes(q)) return 1;

  const display = canon(team.display);
  const pool = new Set([...tokens(display), ...tokens(canon(team.location)), ...tokens(canon(team.short))]);
  const qt = tokens(q);
  if (qt.every((t) => pool.has(t))) {
    // "Gonzaga" ⊂ "Gonzaga Bulldogs". Prefer the team the query covers more of,
    // so "Texas" picks Texas Longhorns over Texas A&M Aggies.
    return 0.8 + 0.1 * (qt.length / Math.max(1, tokens(display).length));
  }
  const meaningful = qt.filter((t) => !GENERIC.has(t));
  if (!meaningful.length) return 0;
  return (0.4 * meaningful.filter((t) => pool.has(t)).length) / meaningful.length;
}

/** Each side must at least contain every word of the sportsbook name. */
const SIDE_MIN = 0.5;

export interface GameTeams {
  id: string;
  away: TeamNames;
  home: TeamNames;
}

/**
 * Find the game for "Away @ Home" (either order, since neutral sites flip).
 * Both teams must match; ties return null so the leg asks for a pick instead of guessing.
 */
export function matchGame<G extends GameTeams>(
  away: string | null,
  home: string | null,
  games: G[],
): G | null {
  const scored = games
    .map((g) => {
      if (away && home) {
        const straight = [teamScore(away, g.away), teamScore(home, g.home)];
        const flipped = [teamScore(away, g.home), teamScore(home, g.away)];
        const best = [straight, flipped]
          .filter((p) => Math.min(...p) >= SIDE_MIN)
          .map((p) => p[0] + p[1]);
        return { g, s: best.length ? Math.max(...best) : 0 };
      }
      // Only one team known (e.g. a moneyline typed without the game).
      const one = away ?? home;
      const s = Math.max(teamScore(one, g.away), teamScore(one, g.home));
      return { g, s: s >= 0.8 ? s : 0 };
    })
    .filter((x) => x.s > 0)
    .sort((a, z) => z.s - a.s);

  if (!scored.length) return null;
  if (scored[1] && scored[0].s - scored[1].s < 0.05) return null;
  return scored[0].g;
}

/** Find a team's game among a day's games (futures "next game"). */
export function matchTeam<G extends GameTeams>(team: string | null, games: G[]): G | null {
  return matchGame(team, null, games);
}

export interface StoredGame {
  away: string | null;
  home: string | null;
  away_short?: string | null;
  home_short?: string | null;
  away_abbr?: string | null;
  home_abbr?: string | null;
}

const side = (g: StoredGame, s: "away" | "home"): TeamNames => ({
  display: (s === "away" ? g.away : g.home) ?? "",
  short: s === "away" ? g.away_short : g.home_short,
  abbr: s === "away" ? g.away_abbr : g.home_abbr,
});

/**
 * Which side of a stored game the leg picked. Uses the leg's own "Away @ Home"
 * text to break ties (e.g. "Texas" when Texas A&M is the opponent).
 */
export function pickedSide(
  leg: { team: string | null; away: string | null; home: string | null },
  game: StoredGame,
): "away" | "home" | null {
  if (!leg.team) return null;
  const a = teamScore(leg.team, side(game, "away"));
  const h = teamScore(leg.team, side(game, "home"));
  if (Math.max(a, h) >= SIDE_MIN && Math.abs(a - h) >= 0.05) return a > h ? "away" : "home";

  // Tie: the pick names one side of the leg's own game text; map that onto ESPN's order.
  const t = canon(leg.team);
  const legSide = t === canon(leg.away) ? "away" : t === canon(leg.home) ? "home" : null;
  if (!legSide || !leg.away || !leg.home) return null;
  const straight = teamScore(leg.away, side(game, "away")) + teamScore(leg.home, side(game, "home"));
  const flipped = teamScore(leg.away, side(game, "home")) + teamScore(leg.home, side(game, "away"));
  if (straight === flipped) return null;
  const sameOrder = straight > flipped;
  return sameOrder ? legSide : legSide === "away" ? "home" : "away";
}
