import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { betNet, fmtDate, fmtMoney, fmtOdds, fmtTime, localToday } from "@/lib/format";
import type { Bet } from "@/lib/types";
import { signOut } from "./login/actions";

/**
 * Milestone 1 home: proves sign-in, RLS and the imported data end to end.
 * The full slate, date strip, futures cards and stats arrive in milestone 2.
 */

const shiftDate = (d: string, days: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

const firstStart = (b: Bet) =>
  b.legs.map((l) => l.start_at).filter((s): s is string => !!s).sort()[0] ?? null;

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense
      fallback={
        <main className="wrap">
          <h1 className="display">Bet Tracker</h1>
          <p className="mute">Loading…</p>
        </main>
      }
    >
      <Slate searchParams={searchParams} />
    </Suspense>
  );
}

async function Slate({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  const sp = await searchParams;
  const qd = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : null;
  const date = qd ?? localToday();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bets")
    .select("*, legs(*, game:games!legs_game_id_fkey(*)), futures_info(*)")
    .order("date");

  if (error) {
    return (
      <main className="wrap">
        <p className="error">Couldn&apos;t load bets: {error.message}</p>
      </main>
    );
  }

  const bets = (data ?? []) as Bet[];
  bets.forEach((b) => b.legs.sort((a, z) => a.position - z.position));

  const day = bets.filter((b) => !b.is_future && b.date === date);
  const futures = bets.filter((b) => b.is_future && b.status === "open");
  const settled = bets.filter((b) => b.status !== "open");

  const dayNet = day.reduce((s, b) => s + betNet(b), 0);
  const dayStaked = day.reduce((s, b) => s + Number(b.stake), 0);
  const dayOpenToWin = day.filter((b) => b.status === "open").reduce((s, b) => s + Number(b.to_win), 0);
  const w = day.filter((b) => b.status === "won").length;
  const l = day.filter((b) => b.status === "lost").length;
  const p = day.filter((b) => b.status === "push").length;
  const seasonNet = settled.reduce((s, b) => s + betNet(b), 0);

  // Group the day's bets by tip time.
  const slots = new Map<string, Bet[]>();
  [...day]
    .sort((a, z) => (firstStart(a) ?? "").localeCompare(firstStart(z) ?? ""))
    .forEach((b) => {
      const key = fmtTime(firstStart(b));
      slots.set(key, [...(slots.get(key) ?? []), b]);
    });

  return (
    <main className="wrap">
      <header className="topbar">
        <h1 className="display">Bet Tracker</h1>
        <form action={signOut}>
          <button className="btn btn-ghost">Sign out</button>
        </form>
      </header>

      <nav className="daynav" aria-label="Day">
        <Link href={`/?date=${shiftDate(date, -1)}`} aria-label="Previous day">‹</Link>
        <strong className="display">{date === localToday() ? `Today · ${fmtDate(date)}` : fmtDate(date)}</strong>
        <Link href={`/?date=${shiftDate(date, 1)}`} aria-label="Next day">›</Link>
      </nav>

      <section className="board" aria-label="Day summary">
        <div className="board-row">
          <div className={`board-cell board-net ${dayNet > 0 ? "pos" : dayNet < 0 ? "neg" : ""}`}>
            <div className="k">Net</div>
            <div className="v">{fmtMoney(dayNet, true)}</div>
          </div>
          <div className="board-cell">
            <div className="k">Staked</div>
            <div className="v">{fmtMoney(dayStaked)}</div>
          </div>
          <div className="board-cell">
            <div className="k">To win</div>
            <div className="v">{fmtMoney(dayOpenToWin)}</div>
          </div>
          <div className="board-cell">
            <div className="k">Record</div>
            <div className="v">{`${w}-${l}${p ? `-${p}` : ""}`}</div>
          </div>
        </div>
      </section>

      {slots.size === 0 && <p className="empty">No bets this day.</p>}
      {[...slots.entries()].map(([time, group]) => (
        <div className="slot" key={time}>
          <div className="slot-time">{time}</div>
          <div className="slot-bets">
            {group.map((b) => (
              <article className="ticket" key={b.id}>
                {b.legs.map((leg) => (
                  <div key={leg.id}>
                    <div className="bet-pick">{leg.pick}</div>
                    <div className="bet-game">
                      {leg.away && leg.home ? `${leg.away} @ ${leg.home}` : leg.market} · {fmtOdds(leg.odds)}
                    </div>
                    {leg.game && (
                      <div className="score">
                        {leg.game.state === "in" && <span className="pill live">Live</span>}{" "}
                        {leg.game.away} {leg.game.away_score ?? "–"} · {leg.game.home} {leg.game.home_score ?? "–"}{" "}
                        <span className="mute">{leg.game.detail}</span>
                      </div>
                    )}
                  </div>
                ))}
                <div className="perf" />
                <div className="bet-money">
                  <span>Stake {fmtMoney(Number(b.stake))}</span>
                  <span>To win {fmtMoney(Number(b.to_win))}</span>
                  <span className={`pill ${b.status}`}>{b.status}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}

      <h2 className="section-title">Futures</h2>
      <div className="futures">
        {futures.length === 0 && <p className="empty">No open futures.</p>}
        {futures.map((b) => {
          const f = b.futures_info;
          return (
            <article className="ticket" key={b.id}>
              <div className="bet-pick">{f?.team ?? b.legs[0]?.pick}</div>
              <div className="bet-game">{f?.market ?? b.legs[0]?.market}</div>
              <div className="bet-money" style={{ marginTop: 6 }}>
                <span>Taken {fmtOdds(b.odds)}</span>
                <span>Now {fmtOdds(f?.odds_now)}</span>
                {f?.record && <span>{f.record}</span>}
                {f?.rank && <span>{f.rank}</span>}
              </div>
              {f?.next_label && (
                <div className="score mute">
                  Next: {f.next_label}
                  {f.next_start ? ` · ${fmtDate(f.next_start.slice(0, 10))} ${fmtTime(f.next_start)}` : ""}
                </div>
              )}
              <div className="perf" />
              <div className="bet-money">
                <span>Stake {fmtMoney(Number(b.stake))}</span>
                <span>To win {fmtMoney(Number(b.to_win))}</span>
                <span className="mute">Settles {f?.settle_date ? fmtDate(f.settle_date) : fmtDate(b.date)}</span>
              </div>
            </article>
          );
        })}
      </div>

      <p className="small mute" style={{ marginTop: 24 }}>
        {bets.length} bets · season net {fmtMoney(seasonNet, true)}
      </p>
    </main>
  );
}
