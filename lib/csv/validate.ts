import type { MappableField } from "@/lib/csv/synonyms";

/** RFC-pragmatic email check (spec §8) — not a full parser on purpose. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isMalformedEmail(email: string): boolean {
  if (!email) return false; // absent is not malformed — identity rule handles absence
  return !EMAIL_RE.test(email);
}

export interface LeadRow {
  /** 1-based line in the uploaded CSV — preserved everywhere (spec §8). */
  line: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  linkedin_url: string;
}

export type ColumnMapping = Partial<Record<MappableField, string>>;

export function extractLeads(
  rows: Array<Record<string, string>>,
  lineNumbers: number[],
  mapping: ColumnMapping,
): LeadRow[] {
  const get = (row: Record<string, string>, field: MappableField) => {
    const col = mapping[field];
    return col ? (row[col] ?? "").trim() : "";
  };
  return rows.map((row, i) => ({
    line: lineNumbers[i],
    first_name: get(row, "first_name"),
    last_name: get(row, "last_name"),
    email: get(row, "email").toLowerCase(),
    phone: get(row, "phone"),
    company: get(row, "company"),
    title: get(row, "title"),
    linkedin_url: get(row, "linkedin_url"),
  }));
}

/**
 * THE identity rule (§3.4 — final, from design review): a row is valid when
 * it satisfies ANY ONE of three identity sets. Email is NOT required.
 *   1. email
 *   2. first_name + last_name + company
 *   3. linkedin_url
 * A malformed email does not count as identity set 1 (it gets cleaned or
 * dropped separately), but the row may still qualify via sets 2 or 3.
 */
export function hasIdentity(row: LeadRow): boolean {
  if (row.email && !isMalformedEmail(row.email)) return true;
  if (row.first_name && row.last_name && row.company) return true;
  if (row.linkedin_url) return true;
  return false;
}

/** Dedupe key: normalized email when present, else linkedin, else name+company. */
export function dedupeKey(row: LeadRow): string {
  if (row.email && !isMalformedEmail(row.email)) return `e:${row.email.toLowerCase()}`;
  if (row.linkedin_url) return `l:${row.linkedin_url.toLowerCase().replace(/\/+$/, "")}`;
  return `n:${row.first_name.toLowerCase()}|${row.last_name.toLowerCase()}|${row.company.toLowerCase()}`;
}

export interface PreflightResult {
  /** Rows failing all three identity sets — NOT "rows missing email". */
  unidentified: LeadRow[];
  /** Rows whose email is present but malformed. Cleaned app-side: the bad
   *  email is removed; the row stays if it still has an identity. */
  malformedEmail: LeadRow[];
  /** Later exact duplicates within this file (first occurrence kept). */
  duplicates: LeadRow[];
  /** Rows that go to Clay after the chosen drops, cleaned. */
  clean: LeadRow[];
}

export interface DropChoices {
  unidentified: boolean;
  malformed: boolean;
  duplicates: boolean;
}

/**
 * Pre-flight, exactly as the design describes it: malformed emails and
 * in-file exact duplicates are resolved HERE — Clay never sees a row the
 * app already knows is a duplicate or has a malformed email. "Keep" on
 * malformed means keep the ROW (email stripped); "keep" on duplicates
 * means keep the extra occurrences; unidentified rows kept anyway will
 * fail in the routine with a readable reason.
 */
export function preflight(rows: LeadRow[], drops: DropChoices): PreflightResult {
  const malformedEmail = rows.filter((r) => r.email && isMalformedEmail(r.email));

  // Clean malformed emails first (always — the cleaning is app-side truth).
  const cleaned = rows.map((r) =>
    r.email && isMalformedEmail(r.email) ? { ...r, email: "" } : r,
  );

  const unidentified = cleaned.filter((r) => !hasIdentity(r));

  const seen = new Set<string>();
  const duplicates: LeadRow[] = [];
  const firstOccurrences = new Set<number>();
  for (const r of cleaned) {
    if (!hasIdentity(r)) continue; // unidentified rows can't meaningfully dupe
    const key = dedupeKey(r);
    if (seen.has(key)) duplicates.push(r);
    else {
      seen.add(key);
      firstOccurrences.add(r.line);
    }
  }

  const malformedLines = new Set(malformedEmail.map((r) => r.line));
  const unidentifiedLines = new Set(unidentified.map((r) => r.line));
  const duplicateLines = new Set(duplicates.map((r) => r.line));

  const clean = cleaned.filter((r) => {
    if (drops.unidentified && unidentifiedLines.has(r.line)) return false;
    if (drops.malformed && malformedLines.has(r.line) && !hasIdentity(r)) return false;
    if (drops.duplicates && duplicateLines.has(r.line)) return false;
    return true;
  });

  return { unidentified, malformedEmail, duplicates, clean };
}
