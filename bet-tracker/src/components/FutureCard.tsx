"use client";

import { daysBetween, fmtDate, fmtDateTime, fmtOdds } from "@/lib/format";
import type { Bet, BetStatus } from "@/lib/types";
import { Controls } from "./Controls";
import { Score } from "./Score";
import { Money } from "./Ticket";

const CHOICES: { status: BetStatus; label: string }[] = [
  { status: "won", label: "Cashed" },
  { status: "lost", label: "Lost" },
];

export function FutureCard({
  bet,
  today,
  busy,
  flash,
  onSet,
  onDelete,
}: {
  bet: Bet;
  today: string;
  busy: boolean;
  flash?: "won" | "lost" | null;
  onSet: (s: BetStatus) => void;
  onDelete: () => void;
}) {
  const i = bet.futures_info;
  const leg = bet.legs[0];
  const settle = i?.settle_date ?? bet.date;
  const days = daysBetween(today, settle);
  const taken = bet.odds;
  const now = i?.odds_now ?? null;
  const live = i?.next_game?.state === "in" ? i.next_game : null;

  return (
    <article className={`fut ${flash ? `flash-${flash}` : ""}`}>
      <div className="top">
        <div>
          <div className="team">{i?.team ?? leg?.pick}</div>
          <div className="meta">
            {bet.sport} · {i?.market ?? leg?.market ?? "Futures"}
          </div>
        </div>
        <Money bet={bet} takenLabel=" taken" />
      </div>

      <div className="fgrid">
        <div>
          <span>Record</span>
          <b>{i?.record ?? "—"}</b>
          {i?.record_note && <small>{i.record_note}</small>}
        </div>
        <div>
          <span>Ranking</span>
          <b>{i?.rank ?? "—"}</b>
          {i?.rank_note && <small>{i.rank_note}</small>}
        </div>
        <div>
          <span>Odds now</span>
          <b>{now ? fmtOdds(now) : "—"}</b>
          {now && taken ? (
            now > taken ? (
              <small className="neg">longer than your {fmtOdds(taken)}</small>
            ) : now < taken ? (
              <small className="pos">shorter — your {fmtOdds(taken)} beats market</small>
            ) : (
              <small>same as yours</small>
            )
          ) : null}
        </div>
        <div>
          <span>Settles</span>
          <b>{fmtDate(settle, { month: "short", day: "numeric", year: "numeric" })}</b>
          {days > 0 && <small>{days} days</small>}
        </div>
      </div>

      {i?.outlook && (
        <div className="fline">
          <b>Outlook:</b> {i.outlook}
        </div>
      )}
      {live && <Score game={live} />}
      {i?.next_label && !live && (
        <div className="fline">
          <b>Next:</b> {i.next_label}
          {i.next_start ? ` · ${fmtDateTime(i.next_start)}` : ""}
          {i.next_where ? ` · ${i.next_where}` : ""}
        </div>
      )}
      {i?.settle_event && (
        <div className="fline meta">
          Settles at: {i.settle_event}
          {i.odds_src ? ` · Odds: ${i.odds_src}` : ""}
        </div>
      )}

      <Controls status={bet.status} choices={CHOICES} busy={busy} onSet={onSet} onDelete={onDelete} />
    </article>
  );
}
