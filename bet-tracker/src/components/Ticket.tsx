"use client";

import { betNet, fmtOdds, signClass, usd } from "@/lib/format";
import { espnUrl } from "@/lib/espn";
import type { Bet, BetStatus, Leg } from "@/lib/types";
import { Controls } from "./Controls";
import { EspnLink, GamePicker, needsGame, Score } from "./Score";

export const gameLabel = (l: Leg) => (l.away && l.home ? `${l.away} @ ${l.home}` : "");

const CHOICES: { status: BetStatus; label: string }[] = [
  { status: "won", label: "Won" },
  { status: "lost", label: "Lost" },
  { status: "push", label: "Push" },
];

export function Money({ bet, takenLabel }: { bet: Bet; takenLabel?: string }) {
  if (bet.status === "open") {
    return (
      <div>
        <div className="money">
          {usd(bet.stake)} → {usd(bet.to_win)}
        </div>
        <div className="meta right">
          {fmtOdds(bet.odds)}
          {takenLabel}
        </div>
      </div>
    );
  }
  const net = betNet(bet);
  return (
    <div>
      <div className={`money ${signClass(net)}`}>{usd(net, true)}</div>
      <div className="meta right">
        {fmtOdds(bet.odds)} · {usd(bet.stake)}
        {bet.settled_by === "auto" ? " · auto" : ""}
      </div>
    </div>
  );
}

export function Ticket({
  bet,
  busy,
  flash,
  onSet,
  onDelete,
  onUpdate,
}: {
  bet: Bet;
  busy: boolean;
  flash?: "won" | "lost" | null;
  onSet: (s: BetStatus) => void;
  onDelete: () => void;
  onUpdate: (b: Bet) => void;
}) {
  const single = bet.type !== "parlay";
  const leg = bet.legs[0];
  const open = bet.status === "open";
  const sub = single && leg ? [leg.market, gameLabel(leg)].filter(Boolean).join(" · ") : "";

  return (
    <article className={`ticket ${flash ? `flash-${flash}` : ""}`}>
      <div className="top">
        <div>
          <div className="pick">{single ? leg?.pick : `${bet.legs.length}-leg parlay`}</div>
          <div className="meta">
            {bet.sport}
            {sub ? ` · ${sub}` : ""}
          </div>
        </div>
        <Money bet={bet} />
      </div>

      {single && leg ? (
        <>
          <Score game={leg.game} leg={leg} />
          {needsGame(bet, leg) && <GamePicker leg={leg} onLinked={onUpdate} />}
          {open && <EspnLink href={espnUrl(bet, leg, leg.game)} />}
        </>
      ) : (
        <ul className="legs">
          {bet.legs.map((l) => (
            <li key={l.id}>
              <span>
                {l.pick}
                {l.result && <span className={`result ${l.result}`}> {l.result}</span>}
                <br />
                <span className="meta">
                  {gameLabel(l)}
                  {l.odds ? ` · ${fmtOdds(l.odds)}` : ""}
                </span>
                <Score game={l.game} leg={l} />
                {needsGame(bet, l) && <GamePicker leg={l} onLinked={onUpdate} />}
                {open && <EspnLink href={espnUrl(bet, l, l.game)} />}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Controls status={bet.status} choices={CHOICES} busy={busy} onSet={onSet} onDelete={onDelete} />
    </article>
  );
}
