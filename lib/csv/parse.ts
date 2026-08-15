import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  /** Row objects keyed by header, in file order. */
  rows: Array<Record<string, string>>;
  /** 1-based CSV line number of each row (header = line 1). */
  lineNumbers: number[];
  delimiter: string;
  hadBom: boolean;
}

/** Strip a UTF-8 BOM — Windows-origin badge-scan exports frequently carry
 *  one, and the first header silently fails to map otherwise (spec §8). */
export function stripBom(text: string): { text: string; hadBom: boolean } {
  if (text.charCodeAt(0) === 0xfeff) return { text: text.slice(1), hadBom: true };
  return { text, hadBom: false };
}

/**
 * Authoritative CSV parse (used client-side for preview and re-run
 * server-side — never trust the client's parse). Auto-detects comma /
 * semicolon / tab, handles quoted fields via PapaParse, skips fully empty
 * lines while preserving original line numbers.
 */
export function parseCsv(input: string): ParsedCsv {
  const { text, hadBom } = stripBom(input);
  const result = Papa.parse<string[]>(text, {
    delimitersToGuess: [",", ";", "\t", "|"],
    skipEmptyLines: false,
  });
  const data = (result.data as string[][]).filter((r) => Array.isArray(r));
  if (data.length === 0) {
    return { headers: [], rows: [], lineNumbers: [], delimiter: ",", hadBom };
  }
  const headers = (data[0] ?? []).map((h) => String(h ?? "").trim());
  const rows: Array<Record<string, string>> = [];
  const lineNumbers: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const raw = data[i];
    if (!raw || raw.every((c) => String(c ?? "").trim() === "")) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, col) => {
      if (h) row[h] = String(raw[col] ?? "").trim();
    });
    rows.push(row);
    lineNumbers.push(i + 1);
  }
  return { headers, rows, lineNumbers, delimiter: result.meta.delimiter ?? ",", hadBom };
}
