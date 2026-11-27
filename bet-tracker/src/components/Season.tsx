import { betNet, fmtDate, shiftYmd, signClass, usd } from "@/lib/format";
import type { Bet } from "@/lib/types";

const SETTLED = new Set(["won", "lost", "push", "cashout"]);

export function Season({ bets, today }: { bets: Bet[]; today: string }) {
  const settled = bets.filter((b) => SETTLED.has(b.status));
  const net = settled.reduce((s, b) => s + betNet(b), 0);
  const risk = settled.reduce((s, b) => s + b.stake, 0);
  const w = settled.filter((b) => b.status === "won").length;
  const l = settled.filter((b) => b.status === "lost").length;

  const days = Array.from({ length: 14 }, (_, i) => {
    const k = shiftYmd(today, i - 13);
    const v = bets.filter((b) => b.date === k && SETTLED.has(b.status)).reduce((s, b) => s + betNet(b), 0);
    return { k, v };
  });
  const max = Math.max(1, ...days.map((d) => Math.abs(d.v)));

  const by: Record<string, number> = {};
  settled.forEach((b) => {
    const k = b.is_future ? "Futures" : b.type === "parlay" ? "Parlays" : b.sport;
    by[k] = (by[k] ?? 0) + betNet(b);
  });
  const rows = Object.entries(by).sort((a, z) => z[1] - a[1]);
  const max2 = Math.max(1, ...rows.map((r) => Math.abs(r[1])));

  return (
    <section>
      <h2>Season</h2>
      <div className="stats">
        <div>
          <span>All-time net</span>
          <b className={signClass(net)}>{usd(net, true)}</b>
        </div>
        <div>
          <span>Record</span>
          <b>
            {w}-{l}
          </b>
        </div>
        <div>
          <span>Win rate</span>
          <b>{w + l ? `${Math.round((w / (w + l)) * 100)}%` : "—"}</b>
        </div>
        <div>
          <span>ROI</span>
          <b className={signClass(net)}>{risk ? `${((net / risk) * 100).toFixed(1)}%` : "—"}</b>
        </div>
      </div>

      <h3>Last 14 days</h3>
      <div className="spark" role="img" aria-label="Daily profit and loss, last 14 days">
        {days.map((d) => {
          const h = (Math.abs(d.v) / max) * 100;
          return (
            <div key={d.k} title={`${fmtDate(d.k)}: ${usd(d.v, true)}`}>
              <span className="up">
                <i style={{ height: `${d.v > 0 ? h : 0}%`, background: "var(--win)" }} />
              </span>
              <span className="down">
                <i style={{ height: `${d.v < 0 ? h : 0}%`, background: "var(--loss)" }} />
              </span>
            </div>
          );
        })}
      </div>

      <h3 style={{ marginTop: 22 }}>Net by sport</h3>
      <div className="bars">
        {rows.length ? (
          rows.map(([k, v]) => (
            <div className="bar" key={k}>
              <span>{k}</span>
              <div className="track">
                <div
                  className="fill"
                  style={{
                    [v >= 0 ? "left" : "right"]: "50%",
                    width: `${(Math.abs(v) / max2) * 50}%`,
                    background: v >= 0 ? "var(--win)" : "var(--loss)",
                  }}
                />
              </div>
              <span className={`v ${signClass(v)}`}>{usd(v, true)}</span>
            </div>
          ))
        ) : (
          <div className="note">Settle a few bets to see where you&apos;re winning.</div>
        )}
      </div>
    </section>
  );
}
