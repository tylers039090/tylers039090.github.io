import { TZ } from "./format";
import type { Bet, Game, Leg } from "./types";

const PATH: Record<string, string> = {
  NFL: "nfl",
  NBA: "nba",
  NHL: "nhl",
  MLB: "mlb",
  NCAAF: "college-football",
  NCAAB: "mens-college-basketball",
  Soccer: "soccer",
};
/** Leagues whose ESPN scoreboard is per day (football is per week). */
const DAILY = new Set(["nba", "nhl", "mlb", "mens-college-basketball", "soccer"]);

/**
 * Link for "Live on ESPN": the game page when the poller has stored one,
 * else that day's scoreboard. espn.com links open the ESPN app on iPhone.
 */
export function espnUrl(bet: Bet, leg: Leg, game?: Game | null): string | null {
  if (game?.espn_url?.startsWith("https://www.espn.com/")) return game.espn_url;
  if (bet.sport === "Golf" || bet.sport === "Other") {
    return /golf|pga|skins|tournament|invitational|masters/i.test(`${leg.pick} ${leg.market ?? ""} ${leg.away ?? ""}`) ||
      bet.sport === "Golf"
      ? "https://www.espn.com/golf/leaderboard"
      : null;
  }
  const path = PATH[bet.sport];
  if (!path) return null;
  const start = game?.start_at ?? leg.start_at;
  const ymd = start
    ? new Date(start).toLocaleDateString("en-CA", { timeZone: TZ }).replaceAll("-", "")
    : bet.date.replaceAll("-", "");
  return `https://www.espn.com/${path}/scoreboard${DAILY.has(path) ? `/_/date/${ymd}` : ""}`;
}
