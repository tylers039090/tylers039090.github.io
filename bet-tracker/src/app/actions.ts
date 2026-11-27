"use server";

import { createClient } from "@/lib/supabase/server";
import { BET_SELECT, normalizeBet } from "@/lib/queries";
import { toSport } from "@/lib/leagues";
import { parsePick } from "@/lib/pick";
import { winAmount, zonedToIso } from "@/lib/format";
import type { Bet, BetStatus } from "@/lib/types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Signed out. Reload and sign in again.");
  return { supabase, userId };
}

async function loadBet(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase.from("bets").select(BET_SELECT).eq("id", id).single();
  if (error) throw new Error(error.message);
  return normalizeBet(data);
}

/** Won / lost / push by hand; the same status again returns the bet to open. */
export async function setStatus(id: string, status: BetStatus): Promise<Result<Bet>> {
  try {
    if (!["open", "won", "lost", "push"].includes(status)) return { ok: false, error: "Unknown status." };
    const { supabase } = await signedIn();
    const open = status === "open";
    const { error } = await supabase
      .from("bets")
      .update({ status, settled_by: open ? null : "manual", payout: null })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };

    // A single's leg mirrors the bet, so grading and undo stay consistent.
    const bet = await loadBet(supabase, id);
    if (bet.type === "single" && bet.legs[0]) {
      await supabase.from("legs").update({ result: open ? null : status }).eq("id", bet.legs[0].id);
      bet.legs[0].result = open ? null : (status as "won" | "lost" | "push");
    }
    return { ok: true, data: bet };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}

export async function deleteBet(id: string): Promise<Result<string>> {
  try {
    const { supabase } = await signedIn();
    const { error } = await supabase.from("bets").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true, data: id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete." };
  }
}

export interface ManualBet {
  date: string;          // YYYY-MM-DD, local
  time: string;          // HH:MM local, may be empty
  sport: string;
  type: "single" | "parlay";
  market: string;        // single only; parlay legs are inferred
  game: string;          // "Away @ Home", single only
  picks: string;         // single: the pick; parlay: one "pick | game" per line
  odds: string;
  stake: string;
  ticket: string;
  future: boolean;
}

const splitGame = (g: string) => {
  const m = g.match(/^(.*?)\s+(?:@|at|vs\.?|v)\s+(.*)$/i);
  return m ? { away: m[1].trim(), home: m[2].trim() } : { away: null, home: null };
};

const inferMarket = (pick: string) => {
  const { line, team } = parsePick(pick, "");
  if (team === "Over" || team === "Under") return "Total";
  if (line != null) return "Spread";
  return "Moneyline";
};

export async function addBet(input: ManualBet): Promise<Result<Bet>> {
  try {
    const { supabase, userId } = await signedIn();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Pick a date." };
    const odds = Math.round(Number(String(input.odds).replace(/[^\d.+-]/g, "")));
    if (!Number.isFinite(odds) || Math.abs(odds) < 100) return { ok: false, error: "Odds must be American, like -110 or +250." };
    const stake = Math.round(Number(String(input.stake).replace(/[$,\s]/g, "")) * 100) / 100;
    if (!(stake > 0)) return { ok: false, error: "Stake must be more than $0." };

    const lines = input.picks.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return { ok: false, error: "Enter the pick." };
    const parlay = input.type === "parlay";
    if (parlay && lines.length < 2) return { ok: false, error: "A parlay needs at least two legs, one per line." };

    const start = /^\d{2}:\d{2}$/.test(input.time) ? zonedToIso(input.date, input.time) : null;
    const isFuture = !parlay && (input.future || input.market === "Futures");

    const legs = parlay
      ? lines.map((line, i) => {
          const [pick, game = ""] = line.split("|").map((s) => s.trim());
          const market = inferMarket(pick);
          return { position: i, pick, market, ...parsePick(pick, market), ...splitGame(game), start_at: start, odds: null };
        })
      : [
          (() => {
            const pick = lines.join(" ");
            const market = isFuture ? "Futures" : input.market || inferMarket(pick);
            return { position: 0, pick, market, ...parsePick(pick, market), ...splitGame(input.game.trim()), start_at: start, odds };
          })(),
        ];

    const { data: row, error } = await supabase
      .from("bets")
      .insert({
        user_id: userId,
        ticket: input.ticket.trim() || null,
        date: input.date,
        type: parlay ? "parlay" : "single",
        sport: toSport(input.sport),
        odds,
        stake,
        to_win: winAmount(stake, odds),
        is_future: isFuture,
        source: "manual",
      })
      .select("id")
      .single();
    if (error) {
      return { ok: false, error: error.code === "23505" ? "That ticket number is already saved." : error.message };
    }

    const { error: legErr } = await supabase.from("legs").insert(legs.map((l) => ({ ...l, bet_id: row.id })));
    if (legErr) {
      await supabase.from("bets").delete().eq("id", row.id);
      return { ok: false, error: legErr.message };
    }
    if (isFuture) {
      await supabase.from("futures_info").insert({
        bet_id: row.id,
        team: legs[0].team,
        market: input.game.trim() || null,
        settle_date: input.date,
      });
    }
    return { ok: true, data: await loadBet(supabase, row.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}
