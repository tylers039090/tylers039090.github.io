"use client";

import { useState, useTransition } from "react";
import { dayGames, linkLeg, type GameChoice } from "@/app/actions";
import { cover } from "@/lib/cover";
import { fmtTime } from "@/lib/format";
import { isEspnId, POLLED } from "@/lib/scoreboard";
import type { Bet, Game, Leg } from "@/lib/types";

/** Score strip: LIVE/FINAL badge, score (flips when it changes), clock, and the cover line. */
export function Score({ game, leg }: { game?: Game | null; leg?: Leg }) {
  if (!game) return null;
  const started = game.state === "in" || game.state === "post";
  const c = leg ? cover(leg, game) : null;
  return (
    <div className="score">
      {game.state === "in" && <span className="live">LIVE</span>}
      {game.state === "post" && <span className="final">FINAL</span>}
      {started ? (
        <b key={`${game.away_score}-${game.home_score}`} className="flip">
          {game.away_short || game.away} {game.away_score ?? ""} · {game.home_short || game.home} {game.home_score ?? ""}
        </b>
      ) : (
        <span className="meta">
          {game.away_short || game.away} @ {game.home_short || game.home} · {fmtTime(game.start_at)}
        </span>
      )}
      {game.detail && game.state === "in" && <span className="meta">{game.detail}</span>}
      {c && <span className={`cover ${c.tone}`}>{c.text}</span>}
    </div>
  );
}

export function EspnLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a className="espn" href={href} target="_blank" rel="noopener noreferrer">
      Live on ESPN ↗
    </a>
  );
}

/** Open, non-futures leg in a sport ESPN covers, not yet tied to an ESPN game. */
export const needsGame = (bet: Bet, leg: Leg) =>
  bet.status === "open" && !bet.is_future && !!POLLED[bet.sport] && !isEspnId(leg.game_id);

/** "Needs game": pick the leg's game from that day's ESPN list. */
export function GamePicker({ leg, onLinked }: { leg: Leg; onLinked: (b: Bet) => void }) {
  const [games, setGames] = useState<GameChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setError(null);
      const r = await dayGames(leg.id);
      if (r.ok) setGames(r.data);
      else setError(r.error);
    });
  const pick = (id: string) =>
    start(async () => {
      const r = await linkLeg(leg.id, id);
      if (r.ok) onLinked(r.data);
      else setError(r.error);
    });

  return (
    <div className="picker">
      {!games ? (
        <button type="button" className="pill needs" onClick={load} disabled={pending}>
          {pending ? "Loading games…" : "Needs game · pick it"}
        </button>
      ) : (
        <>
          <label className="meta" htmlFor={`pick-${leg.id}`}>
            Which game is “{leg.pick}”?
          </label>
          <select
            id={`pick-${leg.id}`}
            defaultValue=""
            disabled={pending}
            onChange={(e) => e.target.value && pick(e.target.value)}
          >
            <option value="" disabled>
              {games.length ? `${games.length} games` : "No games that day"}
            </option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label} · {g.when}
              </option>
            ))}
          </select>
        </>
      )}
      {error && <p className="status neg">{error}</p>}
    </div>
  );
}
