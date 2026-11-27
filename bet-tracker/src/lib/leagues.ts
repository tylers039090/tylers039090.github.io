import type { Sport } from "./types";

/** ESPN `{sport}/{league}` path for each app sport. */
export const ESPN_LEAGUE: Partial<Record<Sport, string>> = {
  NFL: "football/nfl",
  NCAAF: "football/college-football",
  NBA: "basketball/nba",
  NCAAB: "basketball/mens-college-basketball",
  NHL: "hockey/nhl",
  MLB: "baseball/mlb",
  Golf: "golf/pga",
};

export const SPORTS: Sport[] = ["NFL", "NBA", "NHL", "MLB", "NCAAF", "NCAAB", "Soccer", "Golf", "Other"];

export function toSport(s: string | undefined | null): Sport {
  const up = (s ?? "").trim().toUpperCase();
  return SPORTS.find((x) => x.toUpperCase() === up) ?? "Other";
}
