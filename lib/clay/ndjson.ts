import type { RoutineItem } from "@/lib/clay/client";

/** Serialize batch items to JSONL (one item per line, trailing newline). */
export function toNdjson(items: RoutineItem[]): string {
  return items.map((item) => JSON.stringify(item)).join("\n") + "\n";
}

/**
 * Parse a batch result file. The format is UNDOCUMENTED (`format: uri`
 * only); JSONL is the reasonable inference given JSONL input, but a JSON
 * array must also be handled (spec §13). Both are detected by content,
 * not URL.
 */
export function parseResultFile(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("result file JSON is not an array");
    return parsed;
  }
  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
}
