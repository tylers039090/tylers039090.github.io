/**
 * Just enough of the Supabase query builder to run the poller against in-memory
 * tables: select (with the bets!inner / legs(...) embeds the poller uses), eq, is,
 * in, single, maybeSingle, update, upsert, delete, and head counts.
 */
type Row = Record<string, unknown>;
export type Tables = Record<"bets" | "legs" | "futures_info" | "games" | "poller_state", Row[]>;

const get = (row: Row, path: string) =>
  path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Row)[k] : undefined), row);

class Query implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "update" | "upsert" | "delete" = "select";
  private cols = "*";
  private head = false;
  private one: "single" | "maybe" | null = null;
  private patch: Row | Row[] = {};

  constructor(private db: Tables, private table: keyof Tables, private writes: string[]) {}

  select(cols = "*", opts?: { head?: boolean }) {
    this.cols = cols;
    this.head = !!opts?.head;
    return this;
  }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  upsert(rows: Row | Row[]) { this.op = "upsert"; this.patch = rows; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => get(r, col) === v); return this; }
  is(col: string, v: unknown) { this.filters.push((r) => (get(r, col) ?? null) === v); return this; }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(get(r, col))); return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }

  private joined(): Row[] {
    const rows = this.db[this.table];
    return rows.map((r) => {
      const out: Row = { ...r };
      if (this.cols.includes("bets!inner")) out.bets = this.db.bets.find((b) => b.id === r.bet_id);
      if (this.table === "bets" && this.cols.includes("legs(")) out.legs = this.db.legs.filter((l) => l.bet_id === r.id);
      return out;
    });
  }

  private run() {
    const t = this.db[this.table];
    if (this.op === "upsert") {
      for (const row of [this.patch].flat() as Row[]) {
        const i = t.findIndex((x) => x.id === row.id);
        if (i >= 0) t[i] = { ...t[i], ...row };
        else t.push({ ...row });
        this.writes.push(`${this.table}:upsert:${row.id}`);
      }
      return { data: null, error: null };
    }
    const hits = this.joined().filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update" || this.op === "delete") {
      const ids = new Set(hits.map((h) => h.id ?? h.bet_id));
      if (this.op === "delete") this.db[this.table] = t.filter((r) => !ids.has(r.id ?? r.bet_id));
      else t.forEach((r, i) => ids.has(r.id ?? r.bet_id) && (t[i] = { ...r, ...(this.patch as Row) }));
      ids.forEach((id) => this.writes.push(`${this.table}:${this.op}:${id}`));
      return { data: null, error: null };
    }
    if (this.head) return { data: null, error: null, count: hits.length };
    if (this.one) return { data: hits[0] ?? null, error: null };
    return { data: hits, error: null };
  }

  then<A, B>(ok?: ((v: { data: unknown; error: null; count?: number }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }
}

export function fakeAdmin(db: Tables) {
  const writes: string[] = [];
  const client = { from: (t: keyof Tables) => new Query(db, t, writes) };
  return { client: client as never, writes };
}
