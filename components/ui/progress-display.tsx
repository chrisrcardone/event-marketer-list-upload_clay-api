import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { fmtInt } from "@/lib/ui/format";

/**
 * The monitor's primary progress readout: giant tabular percent, processed
 * line + phase hint, honest right-hand stats (rows/min, time left — rendered
 * only when provided; the caller owns the honesty gating), and the tangerine
 * progress bar with the house transition.
 */
export function ProgressDisplay({
  percent,
  processedText,
  phaseHint,
  rateText,
  etaText,
  className,
}: {
  /** 0–100, already floored by the caller. */
  percent: number;
  processedText: string;
  phaseHint?: string;
  /** e.g. "1,240" — omit until it's truthful. */
  rateText?: string;
  /** e.g. "≈ 3 min" — omit until it's truthful. */
  etaText?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-7">
        <div className="flex items-baseline gap-[14px]">
          <span
            aria-hidden="true"
            className="t-display tnum font-medium leading-[0.9] tracking-[-0.04em] text-oat-500"
            style={{ fontSize: "clamp(64px, 9vw, 104px)", fontWeight: 525 }}
          >
            {percent}
          </span>
          <span aria-hidden="true" className="t-display text-[30px] font-medium text-oat-400">
            %
          </span>
        </div>
        <div className="pb-[10px]">
          <div className="t-mono tnum text-[14px] font-medium text-oat-500">{processedText}</div>
          {phaseHint && <div className="t-mono mt-1 text-[12px] text-oat-400">{phaseHint}</div>}
        </div>
        <div className="flex-1" />
        <div className="flex gap-7 pb-[10px]">
          {rateText !== undefined && <SideStat value={rateText} label="rows / min" />}
          {etaText !== undefined && <SideStat value={etaText} label="time left" />}
        </div>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Overall progress"
        className="mt-[22px] h-[10px] overflow-hidden rounded-pill bg-oat-200"
      >
        <div
          className="h-full rounded-pill bg-tangerine-300 transition-[width] duration-[350ms] ease-house"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function SideStat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="text-right">
      <div className="t-mono tnum text-[18px] font-semibold">{value}</div>
      <div className="t-mono-label mt-[2px] text-[10.5px]">{label}</div>
    </div>
  );
}

/** Convenience for the giant-number percent: floor, clamp to [0, 100]. */
export function flooredPercent(finished: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((finished / total) * 100)));
}

export { fmtInt };
