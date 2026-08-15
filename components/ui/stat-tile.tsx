"use client";

import { cn } from "@/lib/ui/cn";
import { fmtInt } from "@/lib/ui/format";
import { useCountUp } from "@/lib/ui/use-count-up";

/**
 * Monitor stat tile: mono uppercase label over a 30px tabular mono value.
 * Numeric values count up with the house easing; string values (e.g. "—",
 * "95.4%") render as-is.
 */
export function StatTile({
  label,
  value,
  danger = false,
  className,
}: {
  label: string;
  value: number | string;
  /** Failed tile turns pom-400 when the count is above zero. */
  danger?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[14px] border border-line bg-white px-[18px] py-4", className)}>
      <div className="t-mono-label mb-2 text-[10.5px]">{label}</div>
      <div
        className={cn(
          "t-mono tnum text-[30px] font-semibold leading-none",
          danger ? "text-pom-400" : "text-oat-500",
        )}
      >
        {typeof value === "number" ? <CountUpInt value={value} /> : value}
      </div>
    </div>
  );
}

function CountUpInt({ value }: { value: number }) {
  const animated = useCountUp(value);
  return <>{fmtInt(Math.round(animated))}</>;
}
