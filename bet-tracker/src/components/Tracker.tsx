"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteBet, setStatus } from "@/app/actions";
import { signOut } from "@/app/login/actions";
import { betNet, fmtDate, fmtTime, shiftYmd, signClass, usd } from "@/lib/format";
import type { Bet, BetStatus } from "@/lib/types";
import { AddBetForm } from "./AddBetForm";
import { FutureCard } from "./FutureCard";
import { Season } from "./Season";
import { Ticket } from "./Ticket";

type View = "daily" | "futures";

const betStart = (b: Bet) =>
  b.legs
    .map((l) => l.game?.start_at ?? l.start_at)
    .filter((s): s is string => !!s)
    .sort()[0] ?? null;

function untilLabel(start: string | null, now: number | null) {
  if (!start || now == null) return "";
  const t = Date.parse(start);
  if (t <= now) return "started";
  const ms = t - now;
  return ms > 36e5 ? `in ${Math.round(ms / 36e5)}h` : `in ${Math.max(1, Math.round(ms / 6e4))}m`;
}

export function Tracker({ initialBets, today }: { initialBets: Bet[]; today: string }) {
  const [bets, setBets] = useState(initialBets);
  const [sel, setSel] = useState(today);
  const [view, setView] = useState<View>("daily");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Record<string, "won" | "lost">>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // Clock for "in 3h" labels; starts after mount so server and client HTML match.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  // Daily / Futures follows the URL hash, like the artifact.
  useEffect(() => {
    const read = () => setView(location.hash === "#futures" ? "futures" : "daily");
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);

  const daily = useMemo(() => bets.filter((b) => !b.is_future), [bets]);
  const futures = useMemo(
    () =>
      bets
        .filter((b) => b.is_future)
        .sort((a, z) => (a.futures_info?.settle_date ?? a.date).localeCompare(z.futures_info?.settle_date ?? z.date)),
    [bets],
  );
  const openFutures = futures.filter((b) => b.status === "open");

  // ── mutations ──
  const mark = (id: string, on: boolean) =>
    setBusy((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  const onSet = useCallback(async (id: string, status: BetStatus) => {
    mark(id, true);
    setError(null);
    const r = await setStatus(id, status);
    mark(id, false);
    if (!r.ok) return setError(`Couldn't save: ${r.error}`);
    setBets((bs) => bs.map((b) => (b.id === id ? r.data : b)));
    if (status === "won" || status === "lost") {
      setFlash((f) => ({ ...f, [id]: status }));
      setTimeout(
        () =>
          setFlash((f) => {
            const rest = { ...f };
            delete rest[id];
            return rest;
          }),
        1200,
      );
    }
  }, []);

  const onDelete = useCallback(async (id: string) => {
    mark(id, true);
    setError(null);
    const r = await deleteBet(id);
    mark(id, false);
    if (!r.ok) return setError(`Couldn't delete: ${r.error}`);
    setBets((bs) => bs.filter((b) => b.id !== id));
  }, []);

  const onSaved = (b: Bet) => {
    setBets((bs) => [...bs, b]);
    if (b.is_future) location.hash = "#futures";
    else setSel(b.date);
  };

  return (
    <div className="wrap">
      <header>
        <h1>Bet Tracker</h1>
        <form action={signOut}>
          <button className="btn alt small-btn">Sign out</button>
        </form>
      </header>

      <nav className="tabs" aria-label="View">
        <a href="#daily" className={view === "daily" ? "on" : ""} aria-current={view === "daily" ? "page" : undefined}>
          Daily
        </a>
        <a href="#futures" className={view === "futures" ? "on" : ""} aria-current={view === "futures" ? "page" : undefined}>
          Futures {openFutures.length > 0 && <span>{openFutures.length}</span>}
        </a>
      </nav>

      {error && (
        <p className="status neg" role="alert">
          {error}
        </p>
      )}

      {view === "daily" ? (
        <>
          <DateStrip today={today} sel={sel} onSel={setSel} betDays={new Set(daily.map((b) => b.date))} />
          <DayBoard bets={daily.filter((b) => b.date === sel)} isToday={sel === today} />
          <Slate
            bets={daily.filter((b) => b.date === sel)}
            sel={sel}
            today={today}
            now={now}
            busy={busy}
            flash={flash}
            onSet={onSet}
            onDelete={onDelete}
          />
        </>
      ) : (
        <>
          <FuturesBoard open={openFutures} />
          <section>
            {futures.length === 0 ? (
              <div className="empty">
                No futures yet. Season-long bets (title, conference, awards) land here instead of the daily slate.
              </div>
            ) : (
              futures.map((b) => (
                <FutureCard
                  key={b.id}
                  bet={b}
                  today={today}
                  busy={busy.has(b.id)}
                  flash={flash[b.id]}
                  onSet={(s) => onSet(b.id, s)}
                  onDelete={() => onDelete(b.id)}
                />
              ))
            )}
          </section>
        </>
      )}

      <AddBetForm defaultDate={sel} onSaved={onSaved} />
      <Season bets={bets} today={today} />
    </div>
  );
}

function DateStrip({
  today,
  sel,
  onSel,
  betDays,
}: {
  today: string;
  sel: string;
  onSel: (d: string) => void;
  betDays: Set<string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const days = useMemo(() => {
    const set = new Set<string>();
    for (let i = -10; i <= 4; i++) set.add(shiftYmd(today, i));
    set.add(sel);
    return [...set].sort();
  }, [today, sel]);

  useEffect(() => {
    ref.current?.querySelector(".on")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [sel]);

  return (
    <div className="dates" ref={ref} role="group" aria-label="Pick a day">
      {days.map((d) => (
        <button
          key={d}
          type="button"
          className={`${d === sel ? "on" : ""} ${betDays.has(d) ? "has" : ""}`}
          aria-pressed={d === sel}
          onClick={() => onSel(d)}
        >
          {d === today ? "Today" : fmtDate(d, { weekday: "short" })}
          <b>{Number(d.slice(8))}</b>
        </button>
      ))}
    </div>
  );
}

function DayBoard({ bets, isToday }: { bets: Bet[]; isToday: boolean }) {
  const net = bets.reduce((s, b) => s + betNet(b), 0);
  const staked = bets.reduce((s, b) => s + b.stake, 0);
  const open = bets.filter((b) => b.status === "open");
  const w = bets.filter((b) => b.status === "won").length;
  const l = bets.filter((b) => b.status === "lost").length;
  const p = bets.filter((b) => b.status === "push").length;
  return (
    <div className="board">
      <div className="big">
        <span>Net {isToday ? "today" : "this day"}</span>
        <div className={`num ${signClass(net)}`}>{usd(net, true)}</div>
      </div>
      <div>
        <span>Staked</span>
        <div className="num">{usd(staked)}</div>
      </div>
      <div>
        <span>Open · to win</span>
        <div className="num">
          {open.length} · {usd(open.reduce((s, b) => s + b.to_win, 0))}
        </div>
      </div>
      <div>
        <span>Record</span>
        <div className="num">
          {w}-{l}
          {p ? `-${p}` : ""}
        </div>
      </div>
    </div>
  );
}

function FuturesBoard({ open }: { open: Bet[] }) {
  const next = open.map((b) => b.futures_info?.settle_date ?? b.date).sort()[0];
  return (
    <div className="board">
      <div className="big">
        <span>Open futures · potential win</span>
        <div className="num">{usd(open.reduce((s, b) => s + b.to_win, 0))}</div>
      </div>
      <div>
        <span>At risk</span>
        <div className="num">{usd(open.reduce((s, b) => s + b.stake, 0))}</div>
      </div>
      <div>
        <span>Open tickets</span>
        <div className="num">{open.length}</div>
      </div>
      <div>
        <span>Next to settle</span>
        <div className="num">{next ? fmtDate(next, { month: "short", day: "numeric" }) : "—"}</div>
      </div>
    </div>
  );
}

function Slate({
  bets,
  sel,
  today,
  now,
  busy,
  flash,
  onSet,
  onDelete,
}: {
  bets: Bet[];
  sel: string;
  today: string;
  now: number | null;
  busy: Set<string>;
  flash: Record<string, "won" | "lost">;
  onSet: (id: string, s: BetStatus) => void;
  onDelete: (id: string) => void;
}) {
  const groups: { key: string; start: string | null; items: Bet[] }[] = [];
  bets
    .map((b) => ({ b, s: betStart(b) }))
    .sort((x, y) => (x.s ?? "~").localeCompare(y.s ?? "~"))
    .forEach(({ b, s }) => {
      const key = s ? fmtTime(s) : "TBD";
      const g = groups.find((g) => g.key === key);
      if (g) g.items.push(b);
      else groups.push({ key, start: s, items: [b] });
    });

  return (
    <section>
      <h2>{sel === today ? "Today's slate" : fmtDate(sel, { weekday: "long", month: "short", day: "numeric" })}</h2>
      {groups.length === 0 ? (
        <div className="empty">No bets on this day yet. Add one below.</div>
      ) : (
        groups.map((g) => (
          <div className="slot" key={g.key}>
            <div className="time">
              {g.key}
              <small>{untilLabel(g.start, now)}</small>
            </div>
            <div>
              {g.items.map((b) => (
                <Ticket
                  key={b.id}
                  bet={b}
                  busy={busy.has(b.id)}
                  flash={flash[b.id]}
                  onSet={(s) => onSet(b.id, s)}
                  onDelete={() => onDelete(b.id)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
