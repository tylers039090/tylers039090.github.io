export type Sport = "NFL" | "NBA" | "NHL" | "MLB" | "NCAAF" | "NCAAB" | "Soccer" | "Golf" | "Other";
export type BetStatus = "open" | "won" | "lost" | "push" | "cashout";
export type LegResult = "won" | "lost" | "push" | null;

export interface Game {
  id: string;
  league: string;
  away: string | null;
  home: string | null;
  away_abbr: string | null;
  home_abbr: string | null;
  away_short?: string | null;
  home_short?: string | null;
  away_score: number | null;
  home_score: number | null;
  state: "pre" | "in" | "post" | null;
  detail: string | null;
  start_at: string | null;
  espn_url: string | null;
  updated_at: string | null;
}

export interface Leg {
  id: string;
  bet_id: string;
  position: number;
  pick: string;
  market: string | null;
  team: string | null;
  line: number | null;
  away: string | null;
  home: string | null;
  start_at: string | null;
  game_id: string | null;
  odds: number | null;
  result: LegResult;
  game?: Game | null;
}

export interface FuturesInfo {
  bet_id: string;
  team: string | null;
  market: string | null;
  odds_now: number | null;
  odds_src: string | null;
  record: string | null;
  record_note: string | null;
  rank: string | null;
  rank_note: string | null;
  next_game_id: string | null;
  next_label: string | null;
  next_start: string | null;
  next_where: string | null;
  settle_date: string | null;
  settle_event: string | null;
  outlook: string | null;
  updated_at: string | null;
  next_game?: Game | null;
}

export interface Bet {
  id: string;
  user_id: string;
  ticket: string | null;
  date: string;
  type: "single" | "parlay";
  sport: Sport;
  odds: number;
  stake: number;
  to_win: number;
  status: BetStatus;
  payout: number | null;
  settled_by: "auto" | "manual" | null;
  is_future: boolean;
  source: "screenshot" | "manual" | null;
  created_at: string;
  legs: Leg[];
  futures_info?: FuturesInfo | null;
}

export interface PollState {
  last_run: string | null;
  last_success: string | null;
  last_error: string | null;
  last_error_at: string | null;
  hot: boolean;
  tracked: number;
}
