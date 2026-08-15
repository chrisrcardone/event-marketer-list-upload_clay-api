import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Every pill color pairing in the approved design, by name.
 * bg / fg (and the dot color where the design animates one).
 */
export type PillTone =
  | "oat" // neutral chip: Queued, Completed campaigns, type chips
  | "lime" // Running, Complete, Active, Written, Found
  | "lemon" // Stalled, Completed with failures, Skipped
  | "pom" // Failed, Validation failed
  | "blueberry" // Uploading, Validating
  | "slushie"; // Finalizing

const tones: Record<PillTone, { bg: string; fg: string; dot: string }> = {
  oat: { bg: "bg-oat-200", fg: "text-oat-500", dot: "bg-oat-400" },
  lime: { bg: "bg-lime-200", fg: "text-lime-500", dot: "bg-lime-400" },
  lemon: { bg: "bg-lemon-200", fg: "text-lemon-500", dot: "bg-lemon-400" },
  pom: { bg: "bg-pom-200", fg: "text-pom-500", dot: "bg-pom-400" },
  blueberry: { bg: "bg-blueberry-100", fg: "text-blueberry-500", dot: "bg-blueberry-300" },
  slushie: { bg: "bg-slushie-100", fg: "text-slushie-500", dot: "bg-slushie-300" },
};

/** Ink overrides the design uses on specific pills: Written rows (#576200),
    Skipped rows (#9E5802), muted "Completed" chips (#7B7974). */
const fgOverrides = {
  "lime-450": "text-lime-450",
  "lemon-400": "text-lemon-400",
  "oat-400": "text-oat-400",
} as const;

const sizes = {
  /** Table-cell pills (Written / Failed / Skipped, history statuses). */
  xs: "text-[9.5px] px-[8px] pt-[4px] pb-[3px]",
  /** Campaign chips, Found, multi-match statuses. */
  sm: "text-[10px] px-[9px] pt-[5px] pb-[4px]",
  /** Run-status pill next to the monitor H1 (may carry a dot). */
  md: "text-[11px] px-[11px] pt-[6px] pb-[5px] gap-[7px]",
} as const;

export interface StatusPillProps {
  tone: PillTone;
  size?: keyof typeof sizes;
  /** Blinking activity dot (run-status pill only). */
  dot?: boolean;
  /** dotBlink period, e.g. "1.4s". Omit for a static dot. */
  dotBlink?: string;
  fgOverride?: keyof typeof fgOverrides;
  className?: string;
  children: ReactNode;
}

export function StatusPill({
  tone,
  size = "sm",
  dot = false,
  dotBlink,
  fgOverride,
  className,
  children,
}: StatusPillProps) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-pill font-mono font-semibold uppercase tracking-[.06em]",
        sizes[size],
        t.bg,
        fgOverride ? fgOverrides[fgOverride] : t.fg,
        className,
      )}
      style={{ fontVariationSettings: '"MONO" 0.5' }}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn("size-[6px] rounded-full", t.dot)}
          style={dotBlink ? { animation: `dotBlink ${dotBlink} infinite` } : undefined}
        />
      )}
      {children}
    </span>
  );
}

/** The eight run statuses, mapped exactly to the prototype's pill spec. */
export type RunStatusKey =
  | "queued"
  | "uploading"
  | "validating"
  | "running"
  | "finalizing"
  | "stalled"
  | "completed_with_failures"
  | "complete"
  | "validation_failed";

const runStatusSpec: Record<
  RunStatusKey,
  { label: string; tone: PillTone; dot?: boolean; blink?: string; fgOverride?: keyof typeof fgOverrides }
> = {
  queued: { label: "Queued", tone: "oat", dot: true },
  uploading: { label: "Uploading", tone: "blueberry", dot: true, blink: "1.2s" },
  validating: { label: "Validating", tone: "blueberry", dot: true, blink: "1.2s" },
  running: { label: "Running", tone: "lime", dot: true, blink: "1.4s" },
  finalizing: { label: "Finalizing", tone: "slushie", dot: true, blink: "1.2s" },
  stalled: { label: "Stalled", tone: "lemon", dot: true, blink: "2s" },
  completed_with_failures: { label: "Completed with failures", tone: "lemon" },
  complete: { label: "Complete", tone: "lime" },
  validation_failed: { label: "Validation failed", tone: "pom" },
};

export function RunStatusPill({
  status,
  className,
}: {
  status: RunStatusKey;
  className?: string;
}) {
  const s = runStatusSpec[status];
  return (
    <span role="status" className={className}>
      <StatusPill tone={s.tone} size="md" dot={s.dot} dotBlink={s.blink} fgOverride={s.fgOverride}>
        {s.label}
      </StatusPill>
    </span>
  );
}
