"use client";

import { useState, useTransition } from "react";
import { addBet, type ManualBet } from "@/app/actions";
import { SPORTS } from "@/lib/leagues";
import { usd, winAmount } from "@/lib/format";
import type { Bet } from "@/lib/types";

const MARKETS = ["Spread", "Moneyline", "Total", "Prop", "Futures", "Other"];

export function AddBetForm({ defaultDate, onSaved }: { defaultDate: string; onSaved: (b: Bet) => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [f, setF] = useState<ManualBet>(() => blank(defaultDate));

  const set = <K extends keyof ManualBet>(k: K, v: ManualBet[K]) => setF((p) => ({ ...p, [k]: v }));
  const preview = winAmount(Number(f.stake) || 0, Math.round(Number(f.odds)) || 0);
  const parlay = f.type === "parlay";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await addBet({ ...f, future: f.market === "Futures" });
      if (!r.ok) return setMsg({ text: r.error, err: true });
      onSaved(r.data);
      setMsg({ text: "Saved." });
      setF(blank(f.date));
      setOpenForm(false);
    });
  };

  return (
    <section>
      <h2>Add bets</h2>
      <div className="adders">
        <button
          className="btn"
          type="button"
          aria-expanded={openForm}
          onClick={() => {
            if (!openForm) setF((p) => ({ ...p, date: defaultDate }));
            setOpenForm(!openForm);
            setMsg(null);
          }}
        >
          Enter manually
        </button>
      </div>
      {msg && (
        <p className={`status ${msg.err ? "neg" : ""}`} role="status">
          {msg.text}
        </p>
      )}

      {openForm && (
        <form className="addform" onSubmit={submit}>
          <label>
            Date
            <input type="date" required value={f.date} onChange={(e) => set("date", e.target.value)} />
          </label>
          <label>
            Start time
            <input type="time" value={f.time} onChange={(e) => set("time", e.target.value)} />
          </label>
          <label>
            Sport
            <select value={f.sport} onChange={(e) => set("sport", e.target.value)}>
              {SPORTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Bet type
            <select value={f.type} onChange={(e) => set("type", e.target.value as ManualBet["type"])}>
              <option value="single">Single</option>
              <option value="parlay">Parlay</option>
            </select>
          </label>
          {!parlay && (
            <>
              <label>
                Market
                <select value={f.market} onChange={(e) => set("market", e.target.value)}>
                  {MARKETS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                Ticket # (optional)
                <input inputMode="numeric" value={f.ticket} onChange={(e) => set("ticket", e.target.value)} />
              </label>
              <label className="full">
                {f.market === "Futures" ? "Market name" : "Game (Away @ Home)"}
                <input
                  value={f.game}
                  placeholder={f.market === "Futures" ? "Super Bowl LXI winner" : "Packers @ Lions"}
                  onChange={(e) => set("game", e.target.value)}
                />
              </label>
            </>
          )}
          <label className="full">
            {parlay ? 'Legs — one per line as "pick | Away @ Home"' : "Pick"}
            <textarea
              rows={parlay ? 4 : 2}
              required
              value={f.picks}
              placeholder={parlay ? "Lions -3.5 | Packers @ Lions\nOver 47.5 | Bears @ Vikings" : "Lions -3.5"}
              onChange={(e) => set("picks", e.target.value)}
            />
          </label>
          {parlay && (
            <label className="full">
              Ticket # (optional)
              <input inputMode="numeric" value={f.ticket} onChange={(e) => set("ticket", e.target.value)} />
            </label>
          )}
          <label>
            Odds (American)
            <input inputMode="numeric" required placeholder="-110" value={f.odds} onChange={(e) => set("odds", e.target.value)} />
          </label>
          <label>
            Stake ($)
            <input inputMode="decimal" required placeholder="50" value={f.stake} onChange={(e) => set("stake", e.target.value)} />
          </label>
          <p className="full note">{preview ? `To win ${usd(preview)}` : " "}</p>
          <div className="full row">
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save bet"}
            </button>
            <button className="btn alt" type="button" onClick={() => setOpenForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function blank(date: string): ManualBet {
  return {
    date, time: "", sport: "NCAAB", type: "single", market: "Spread",
    game: "", picks: "", odds: "", stake: "", ticket: "", future: false,
  };
}
