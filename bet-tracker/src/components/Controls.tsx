"use client";

import { useEffect, useState } from "react";
import type { BetStatus } from "@/lib/types";

type Choice = { status: BetStatus; label: string };

/** Won / Lost / Push pills plus a two-tap Delete. */
export function Controls({
  status,
  choices,
  busy,
  onSet,
  onDelete,
}: {
  status: BetStatus;
  choices: Choice[];
  busy: boolean;
  onSet: (s: BetStatus) => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  return (
    <div className="row">
      {choices.map((c) => (
        <button
          key={c.status}
          type="button"
          className={`pill ${c.status} ${status === c.status ? "on" : ""}`}
          aria-pressed={status === c.status}
          disabled={busy}
          onClick={() => onSet(status === c.status ? "open" : c.status)}
        >
          {c.label}
        </button>
      ))}
      <button
        type="button"
        className="pill del"
        disabled={busy}
        onClick={() => (confirm ? onDelete() : setConfirm(true))}
      >
        {confirm ? "Tap again to delete" : "Delete"}
      </button>
    </div>
  );
}
