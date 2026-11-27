import { pickedSide, type StoredGame } from "./match";

export interface CoverInput {
  pick: string;
  market: string | null;
  team: string | null;
  line: number | null;
  away: string | null;
  home: string | null;
}

export interface GameScore extends StoredGame {
  away_score: number | null;
  home_score: number | null;
  state: "pre" | "in" | "post" | null;
}

export interface Cover {
  /** > 0 winning, < 0 losing, 0 push — the leg's margin against its line. */
  margin: number;
  text: string;
  tone: "pos" | "neg" | "";
}

const n = (x: number) => String(Math.round(Math.abs(x) * 10) / 10);

/**
 * Margin against the line from the current (or final) score.
 * Spread: picked score + line − opponent. Total: combined vs line for Over/Under.
 * Moneyline: picked score − opponent. Props and anything unparsed return null.
 */
export function cover(leg: CoverInput, game: GameScore | null | undefined): Cover | null {
  if (!game || (game.state !== "in" && game.state !== "post")) return null;
  if (game.away_score == null || game.home_score == null) return null;
  const final = game.state === "post";
  const market = (leg.market ?? "").toLowerCase();
  const tone = (m: number): Cover["tone"] => (m > 0 ? "pos" : m < 0 ? "neg" : "");

  if (market === "total" || leg.team === "Over" || leg.team === "Under") {
    if (leg.line == null || (leg.team !== "Over" && leg.team !== "Under")) return null;
    const total = game.away_score + game.home_score;
    const over = leg.team === "Over";
    const m = over ? total - leg.line : leg.line - total;
    const text =
      m === 0 ? "push" :
      m > 0 ? `${final ? "covered" : "covering"} by ${n(m)}` :
      final ? `missed by ${n(m)}` :
      over ? `needs ${n(m)}` : `over by ${n(m)}`;
    return { margin: m, text: `${leg.pick}: ${text}`, tone: tone(m) };
  }

  if (market !== "spread" && market !== "moneyline") return null;
  const s = pickedSide(leg, game);
  if (!s) return null;
  const mine = s === "away" ? game.away_score : game.home_score;
  const theirs = s === "away" ? game.home_score : game.away_score;

  if (market === "spread") {
    if (leg.line == null) return null;
    const m = mine + leg.line - theirs;
    const text =
      m === 0 ? "push" :
      m > 0 ? `${final ? "covered" : "covering"} by ${n(m)}` :
      final ? `missed by ${n(m)}` : `needs ${n(m)}`;
    return { margin: m, text: `${leg.pick}: ${text}`, tone: tone(m) };
  }

  const m = mine - theirs;
  const text =
    m === 0 ? (final ? "tie" : "tied") :
    m > 0 ? `${final ? "won" : "leading"} by ${n(m)}` :
    `${final ? "lost" : "trailing"} by ${n(m)}`;
  return { margin: m, text: `${leg.team ?? leg.pick}: ${text}`, tone: tone(m) };
}
