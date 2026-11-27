/**
 * Parse a pick string into the side and number used for grading.
 *   "Gonzaga -3.5"   (Spread)    -> { team: "Gonzaga", line: -3.5 }
 *   "Texas A&M +11"  (Spread)    -> { team: "Texas A&M", line: 11 }
 *   "Over 47.5"      (Total)     -> { team: "Over", line: 47.5 }
 *   "Kansas ML"      (Moneyline) -> { team: "Kansas", line: null }
 *   anything else                -> { team: pick, line: null }
 */
export function parsePick(pick: string, market?: string | null): { team: string | null; line: number | null } {
  const p = pick.trim();
  const m = (market ?? "").toLowerCase();

  const total = p.match(/^(over|under|o|u)\s*(\d+(?:\.\d+)?)$/i);
  if (total && (m === "total" || m === "")) {
    return { team: total[1].toLowerCase().startsWith("o") ? "Over" : "Under", line: Number(total[2]) };
  }

  if (m === "spread" || m === "") {
    const spread = p.match(/^(.*?)\s+([+-]\d+(?:\.\d+)?|pk|pick|even)$/i);
    if (spread) {
      const raw = spread[2].toLowerCase();
      const line = raw === "pk" || raw === "pick" || raw === "even" ? 0 : Number(raw);
      return { team: spread[1].trim(), line };
    }
  }

  if (m === "moneyline") return { team: p.replace(/\s+(ml|moneyline)$/i, "").trim(), line: null };

  return { team: p || null, line: null };
}
