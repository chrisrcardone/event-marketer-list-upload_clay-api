import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * White card on the cream page. The design uses three radii:
 * 16 (sections, tables), 14 (stat tiles, selected campaign), 20 (progress,
 * summary, empty states). Border is always 1px --grey-line (#E6E8EC) for
 * section cards; #EDEBE8 hairline is reserved for on-cream sub-cards.
 */
export function Card({
  radius = 16,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { radius?: 14 | 16 | 20 }) {
  return (
    <section
      className={cn(
        "border border-line bg-white",
        radius === 14 && "rounded-[14px]",
        radius === 16 && "rounded-lg",
        radius === 20 && "rounded-[20px]",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

/** Section header: display title + mono hint on one baseline ("Upload" · "CSV · up to 50,000 rows"). */
export function CardTitle({
  title,
  hint,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline gap-[10px]", className)}>
      <h2 className="t-display m-0 text-[18px] font-medium tracking-[-0.015em]">{title}</h2>
      {hint && <span className="t-mono-label">{hint}</span>}
    </div>
  );
}
