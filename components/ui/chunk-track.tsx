import { cn } from "@/lib/ui/cn";
import { fmtInt } from "@/lib/ui/format";

export type ChunkState = "queued" | "running" | "done" | "failed";

export interface ChunkCell {
  /** 1-based chunk number. */
  index: number;
  state: ChunkState;
  /** Rows finished in this chunk so far. */
  finished: number;
  /** Rows in this chunk (≤ 100). */
  size: number;
}

const cellColors: Record<ChunkState, { bg: string; bd: string; fg: string }> = {
  failed: { bg: "bg-pom-200", bd: "border-pom-200", fg: "text-pom-500" },
  done: { bg: "bg-lime-200", bd: "border-lime-200", fg: "text-lime-450" },
  running: { bg: "bg-tangerine-200", bd: "border-tangerine-200", fg: "text-tangerine-400" },
  queued: { bg: "bg-oat-200", bd: "border-line", fg: "text-oat-400" },
};

function cellTitle(c: ChunkCell, paused: boolean): string {
  const state =
    c.state === "failed"
      ? "failed"
      : c.state === "done"
        ? "complete"
        : c.state === "running"
          ? paused
            ? `stuck at ${c.finished} of ${c.size}`
            : `running · ${c.finished} of ${c.size}`
          : "queued";
  return `Chunk ${c.index} — ${state}`;
}

/**
 * The monitor's chunk track. Three densities, chosen by chunk count so the
 * same component looks right at 4, 53, and 500 chunks:
 *   ≤ 14   discrete cells (46px tall, chunk number + finished/size)
 *   ≤ 80   dense strip (16px tall, 2px gaps, tooltips carry the detail)
 *   > 80   micro strip (16px tall, no gaps — a continuous segmented bar)
 *
 * `paused` freezes the running-cell pulse (stalled / rate-limited / offline),
 * matching the prototype, and flips tooltips to "stuck at…".
 */
export function ChunkTrack({
  chunks,
  paused = false,
  label = "Chunks · 100 rows each",
  className,
}: {
  chunks: ChunkCell[];
  paused?: boolean;
  label?: string;
  className?: string;
}) {
  const doneCount = chunks.filter((c) => c.state === "done").length;
  const density = chunks.length <= 14 ? "discrete" : chunks.length <= 80 ? "dense" : "micro";

  return (
    <div className={className}>
      <div className="mb-[9px] flex flex-wrap items-baseline justify-between gap-[10px]">
        <span className="t-mono-label">{label}</span>
        <span className="t-mono tnum text-[11px] text-oat-400">
          {fmtInt(doneCount)} of {fmtInt(chunks.length)} complete
        </span>
      </div>
      <div
        role="img"
        aria-label={`Chunk progress: ${doneCount} of ${chunks.length} chunks complete`}
        className={cn(
          "flex",
          density === "discrete" && "gap-2",
          density === "dense" && "gap-[2px]",
          density === "micro" && "gap-0 overflow-hidden rounded-[3px]",
        )}
      >
        {chunks.map((c) => {
          const colors = cellColors[c.state];
          const pulse = c.state === "running" && !paused;
          return (
            <div
              key={c.index}
              title={cellTitle(c, paused)}
              className={cn(
                "min-w-0 flex-1 border transition-colors duration-300",
                colors.bg,
                colors.bd,
                density === "discrete" &&
                  "flex h-[46px] flex-col items-center justify-center gap-[2px] rounded-[10px]",
                density === "dense" && "h-4 rounded-[3px]",
                density === "micro" && "h-4 rounded-none border-y border-x-0",
              )}
              style={pulse ? { animation: "chunkPulse 1.5s cubic-bezier(.2,0,0,1) infinite" } : undefined}
            >
              {density === "discrete" && (
                <>
                  <span className={cn("t-mono tnum text-[11px] font-semibold leading-none", colors.fg)}>
                    {c.index}
                  </span>
                  <span className={cn("t-mono tnum text-[10px] leading-none opacity-70", colors.fg)}>
                    {c.finished}/{c.size}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
