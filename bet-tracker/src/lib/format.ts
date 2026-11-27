export const TZ = "America/Los_Angeles";

export const fmtOdds = (o: number | null | undefined) => (o == null ? "—" : o > 0 ? `+${o}` : `${o}`);

export const fmtMoney = (n: number, signed = false) => {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!signed) return `$${s}`;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}$${s}`;
};

export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "TBD";

export const fmtDate = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/** Today's date (YYYY-MM-DD) in America/Los_Angeles. */
export const localToday = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

/** Net result of a bet: +to_win, −stake, cashout payout − stake, else 0. */
export function betNet(b: { status: string; stake: number; to_win: number; payout: number | null }) {
  switch (b.status) {
    case "won":
      return Number(b.to_win);
    case "lost":
      return -Number(b.stake);
    case "cashout":
      return Number(b.payout ?? 0) - Number(b.stake);
    default:
      return 0;
  }
}
