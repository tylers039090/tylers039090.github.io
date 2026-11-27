import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { localToday } from "@/lib/format";
import { BET_SELECT, normalizeBet } from "@/lib/queries";
import { Tracker } from "@/components/Tracker";
import type { PollState } from "@/lib/types";

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="wrap">
          <header>
            <h1>Bet Tracker</h1>
          </header>
          <p className="note">Loading bets…</p>
        </div>
      }
    >
      <Bets />
    </Suspense>
  );
}

async function Bets() {
  const supabase = await createClient();
  const [{ data, error }, { data: poll }] = await Promise.all([
    supabase.from("bets").select(BET_SELECT).order("date"),
    supabase.from("poller_state").select("*").eq("id", 1).maybeSingle(),
  ]);

  if (error) {
    return (
      <div className="wrap">
        <header>
          <h1>Bet Tracker</h1>
        </header>
        <p className="status neg">Couldn&apos;t load bets: {error.message}</p>
      </div>
    );
  }

  return (
    <Tracker
      initialBets={(data ?? []).map(normalizeBet)}
      initialPoll={(poll as PollState | null) ?? null}
      today={localToday()}
    />
  );
}
