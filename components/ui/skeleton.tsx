import { cn } from "@/lib/ui/cn";

/**
 * Static skeleton bar (the brand is calm — no shimmer). Used wherever content
 * shape is known before data lands, e.g. the results-table waiting state.
 */
export function Skeleton({
  width = "100%",
  height = 12,
  className,
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-[6px] bg-oat-200", className)}
      style={{ width, height }}
    />
  );
}

/** The exact three-bar waiting block from the results table (62% / 78% / 55%). */
export function SkeletonRows({ note }: { note?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton width="62%" />
      <Skeleton width="78%" />
      <Skeleton width="55%" />
      {note && <div className="t-mono mt-2 text-[11.5px] text-oat-400">{note}</div>}
    </div>
  );
}
