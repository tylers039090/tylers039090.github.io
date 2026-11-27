import type { Bet } from "./types";

/** Everything a ticket or futures card needs, in one PostgREST select. */
export const BET_SELECT =
  "*, legs(*, game:games!legs_game_id_fkey(*)), futures_info(*, next_game:games!futures_info_next_game_id_fkey(*))";

/** PostgREST returns numerics as strings and 1:1 embeds as object or array; normalize. */
export function normalizeBet(row: Record<string, unknown>): Bet {
  const b = row as unknown as Bet & { futures_info: unknown };
  const fi = Array.isArray(b.futures_info) ? b.futures_info[0] ?? null : b.futures_info ?? null;
  return {
    ...b,
    odds: Number(b.odds),
    stake: Number(b.stake),
    to_win: Number(b.to_win),
    payout: b.payout == null ? null : Number(b.payout),
    futures_info: fi as Bet["futures_info"],
    legs: [...(b.legs ?? [])]
      .map((l) => ({ ...l, line: l.line == null ? null : Number(l.line) }))
      .sort((a, z) => a.position - z.position),
  };
}
