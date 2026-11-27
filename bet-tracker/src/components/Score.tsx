import { fmtTime } from "@/lib/format";
import type { Game } from "@/lib/types";

/** Score strip under a leg: LIVE/FINAL badge, score line, clock. */
export function Score({ game }: { game?: Game | null }) {
  if (!game) return null;
  const started = game.state === "in" || game.state === "post";
  return (
    <div className="score">
      {game.state === "in" && <span className="live">LIVE</span>}
      {game.state === "post" && <span className="final">FINAL</span>}
      {started ? (
        <b>
          {game.away} {game.away_score ?? ""} · {game.home} {game.home_score ?? ""}
        </b>
      ) : (
        <span className="meta">{fmtTime(game.start_at)}</span>
      )}
      {game.detail && started && <span className="meta">{game.detail}</span>}
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
