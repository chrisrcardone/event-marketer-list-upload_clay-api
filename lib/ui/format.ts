/** "252" seconds → "4:12" — the monitor's elapsed clock format. */
export function fmtElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** 1204 → "1,204" (en-US grouping regardless of viewer locale, per the design). */
export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Seconds since a timestamp → "just now" | "12s ago" (monitor "Updated" text). */
export function fmtAgo(agoSeconds: number): string {
  return agoSeconds < 3 ? "just now" : `${Math.round(agoSeconds)}s ago`;
}

/** Truncate a Salesforce record id the way the design shows it: "701Kd…HcQAJ". */
export function truncateSfId(id: string): string {
  if (id.length <= 11) return id;
  return `${id.slice(0, 5)}…${id.slice(-5)}`;
}
