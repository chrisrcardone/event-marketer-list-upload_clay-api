import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Table primitives matching the design: sticky oat-200 header in mono
 * uppercase, hairline #EFF1F3 row separators, tabular figures, optional
 * sticky first column, and a scroll container so wide tables scroll inside
 * their card instead of the page.
 */

export function TableScroll({
  maxHeight,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { maxHeight?: number }) {
  return (
    <div
      className={cn("overflow-auto", className)}
      style={maxHeight ? { maxHeight } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Table({
  minWidth,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLTableElement> & { minWidth?: number }) {
  return (
    <table
      className={cn("w-full border-separate border-spacing-0 text-[13px]", className)}
      style={minWidth ? { minWidth } : undefined}
      {...rest}
    >
      {children}
    </table>
  );
}

export function Th({
  stickyLeft = false,
  sticky = true,
  className,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { stickyLeft?: boolean; sticky?: boolean }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap bg-oat-200 px-[14px] py-[9px] text-left font-mono text-[10.5px] font-semibold uppercase tracking-[.05em] text-oat-400",
        sticky && "sticky top-0 z-[2]",
        stickyLeft && "left-0 z-[3]",
        className,
      )}
      style={{ fontVariationSettings: '"MONO" 0.5' }}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  stickyLeft = false,
  className,
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { stickyLeft?: boolean }) {
  return (
    <td
      className={cn(
        "whitespace-nowrap border-t border-line-soft px-[14px] py-[10px]",
        stickyLeft && "sticky left-0 bg-white",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
