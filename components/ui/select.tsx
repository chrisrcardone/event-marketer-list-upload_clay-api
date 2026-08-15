import type { SelectHTMLAttributes } from "react";
import { CaretDown } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/ui/cn";

/**
 * Native select in the column-mapping clothing: 1px --grey-line border,
 * radius 9, padding 8×10, 13px body font, custom caret. Native menus keep
 * keyboard and screen-reader behavior for free.
 */
export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        className="w-full cursor-pointer appearance-none rounded-[9px] border border-line bg-white py-2 pl-[10px] pr-[30px] font-body text-[13px] text-oat-500"
        {...rest}
      >
        {children}
      </select>
      <CaretDown
        aria-hidden="true"
        size={12}
        className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2 text-oat-400"
      />
    </span>
  );
}
