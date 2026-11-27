import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { localToday } from "@/lib/format";
import { BET_SELECT, normalizeBet } from "@/lib/queries";
import { Tracker } from "@/components/Tracker";

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
  const { data, error } = await supabase.from("bets").select(BET_SELECT).order("date");

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

  return <Tracker initialBets={(data ?? []).map(normalizeBet)} today={localToday()} />;
}
