"use client";

import { cn } from "@/lib/ui/cn";

/**
 * Two-option segmented toggle (the pre-flight Drop / Keep control):
 * oat-200 pill track with 3px padding, ink-filled active segment.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex rounded-pill bg-oat-200 p-[3px]", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "cursor-pointer rounded-pill border-0 px-[14px] py-[6px] font-display text-[12.5px] font-medium transition-colors duration-[120ms]",
              active ? "bg-oat-500 text-oat-100" : "bg-transparent text-oat-400",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
