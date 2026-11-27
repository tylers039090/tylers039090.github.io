"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteBet, setStatus } from "@/app/actions";
import { signOut } from "@/app/login/actions";
import { betNet, fmtDate, fmtTime, shiftYmd, signClass, usd } from "@/lib/format";
import { BET_SELECT, normalizeBet } from "@/lib/queries";
import { createClient } from "@/lib/supabase/client";
import type { Bet, BetStatus, Game, PollState } from "@/lib/types";
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

const upsertBet = (bs: Bet[], b: Bet) => (bs.some((x) => x.id === b.id) ? bs.map((x) => (x.id === b.id ? b : x)) : [...bs, b]);

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Tracker({
  initialBets,
  initialPoll,
  today,
}: {
  initialBets: Bet[];
  initialPoll: PollState | null;
  today: string;
}) {
  const [bets, setBets] = useState(initialBets);
  const [poll, setPoll] = useState(initialPoll);
  const [live, setLive] = useState<"connecting" | "live" | "offline">("connecting");
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

  // Realtime: the poller writes games; phones never call ESPN. Scores patch in place.
  useEffect(() => {
    const sb = createClient();
    let alive = true;
    let channel: ReturnType<typeof sb.channel> | null = null;

    const refetchBet = async (id: string) => {
      const { data } = await sb.from("bets").select(BET_SELECT).eq("id", id).maybeSingle();
      if (!alive) return;
      setBets((bs) => (data ? upsertBet(bs, normalizeBet(data)) : bs.filter((b) => b.id !== id)));
    };
    const refetchAll = async () => {
      const [{ data }, { data: p }] = await Promise.all([
        sb.from("bets").select(BET_SELECT).order("date"),
        sb.from("poller_state").select("*").eq("id", 1).maybeSingle(),
      ]);
      if (!alive) return;
      if (data) setBets(data.map(normalizeBet));
      if (p) setPoll(p as PollState);
    };
    const patchGame = (g: Game) =>
      setBets((bs) =>
        bs.map((b) => {
          const touchesLeg = b.legs.some((l) => l.game_id === g.id);
          const touchesFuture = b.futures_info?.next_game_id === g.id;
          if (!touchesLeg && !touchesFuture) return b;
          return {
            ...b,
            legs: touchesLeg ? b.legs.map((l) => (l.game_id === g.id ? { ...l, game: g } : l)) : b.legs,
            futures_info: touchesFuture && b.futures_info ? { ...b.futures_info, next_game: g } : b.futures_info,
          };
        }),
      );
    const betIdOf = (row: unknown) => (row as { bet_id?: string } | null)?.bet_id;

    (async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) sb.realtime.setAuth(data.session.access_token);
      if (!alive) return;
      channel = sb
        .channel("bet-tracker")
        .on("postgres_changes", { event: "*", schema: "public", table: "games" }, (p) => {
          if (p.eventType !== "DELETE") patchGame(p.new as Game);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "legs" }, (p) => {
          const id = betIdOf(p.new) ?? betIdOf(p.old);
          if (id) refetchBet(id);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "futures_info" }, (p) => {
          const id = betIdOf(p.new) ?? betIdOf(p.old);
          if (id) refetchBet(id);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, (p) => {
          if (p.eventType === "DELETE") {
            const id = (p.old as { id?: string }).id;
            if (id) setBets((bs) => bs.filter((b) => b.id !== id));
          } else refetchBet((p.new as { id: string }).id);
        })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "poller_state" }, (p) =>
          setPoll(p.new as PollState),
        )
        .subscribe((status) => {
          if (!alive) return;
          if (status === "SUBSCRIBED") setLive("live");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("offline");
        });
    })();

    // iOS suspends Home Screen apps; catch up whenever the app comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible") refetchAll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) sb.removeChannel(channel);
    };
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

  const onUpdate = useCallback((b: Bet) => setBets((bs) => upsertBet(bs, b)), []);

  const onSaved = (b: Bet) => {
    setBets((bs) => upsertBet(bs, b));
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

      <div className="tabs-row">
        <nav className="tabs" aria-label="View">
          <a href="#daily" className={view === "daily" ? "on" : ""} aria-current={view === "daily" ? "page" : undefined}>
            Daily
          </a>
          <a href="#futures" className={view === "futures" ? "on" : ""} aria-current={view === "futures" ? "page" : undefined}>
            Futures {openFutures.length > 0 && <span>{openFutures.length}</span>}
          </a>
        </nav>
        <span className={`sync ${live}`} role="status">
          {live === "live" ? "Live" : live === "offline" ? "Offline" : "Connecting…"}
        </span>
      </div>

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
            onUpdate={onUpdate}
          />
          <ScoreAge poll={poll} now={now} anyLive={daily.some((b) => b.date === sel && b.legs.some((l) => l.game?.state === "in"))} />
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
  onUpdate,
}: {
  bets: Bet[];
  sel: string;
  today: string;
  now: number | null;
  busy: Set<string>;
  flash: Record<string, "won" | "lost">;
  onSet: (id: string, s: BetStatus) => void;
  onDelete: (id: string) => void;
  onUpdate: (b: Bet) => void;
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
                  onUpdate={onUpdate}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

/** Fail soft: say how old the scores are, and when ESPN or the poller is down. */
function ScoreAge({ poll, now, anyLive }: { poll: PollState | null; now: number | null; anyLive: boolean }) {
  if (now == null) return null;
  if (!poll?.last_success) {
    return <p className="note">Live scores appear once the score poller has run.</p>;
  }
  const age = now - Date.parse(poll.last_success);
  const failing = !!poll.last_error_at && Date.parse(poll.last_error_at) > Date.parse(poll.last_success);
  const stale = anyLive && age > 2 * 60_000;
  if (failing || stale) {
    return (
      <p className="note neg" role="status">
        {failing ? "ESPN isn't responding" : "Scores are behind"} — showing scores from {ago(age)}.
      </p>
    );
  }
  return <p className="note">Scores checked {ago(now - Date.parse(poll.last_run ?? poll.last_success))}.</p>;
}
