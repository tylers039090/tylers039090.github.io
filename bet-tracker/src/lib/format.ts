/** All dates and times display in Tyler's zone, on server and phone alike. */
export const TZ = "America/Los_Angeles";

export const fmtOdds = (o: number | null | undefined) => (!o ? "—" : o > 0 ? `+${o}` : `${o}`);

/** $50 / $10.50; signed adds + or − (true minus). */
export function usd(n: number, signed = false) {
  const v = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(n) % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
  if (signed) return (n > 0 ? "+" : n < 0 ? "−" : "") + v;
  return (n < 0 ? "−" : "") + v;
}

/** Kept for milestone-1 callers. */
export const fmtMoney = (n: number, signed = false) => usd(n, signed);

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "TBD";

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** Format a YYYY-MM-DD calendar date (no zone shift). */
export const fmtDate = (ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

/** YYYY-MM-DD of an instant in Tyler's zone. */
export const localYmd = (d: Date = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
export const localToday = () => localYmd();

export function shiftYmd(ymd: string, days: number) {
  const t = new Date(`${ymd}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Days from one YYYY-MM-DD to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);

/**
 * Convert a wall-clock date + time in Tyler's zone to an ISO instant,
 * e.g. ("2026-11-27", "14:00") -> "2026-11-27T22:00:00.000Z".
 */
export function zonedToIso(ymd: string, hm: string) {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asZoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asZoned - guess)).toISOString();
}

/** Profit on a winning bet from stake and American odds. */
export function winAmount(stake: number, odds: number) {
  if (!odds || !stake) return 0;
  const v = odds > 0 ? (stake * odds) / 100 : (stake * 100) / Math.abs(odds);
  return Math.round(v * 100) / 100;
}

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

export const signClass = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
