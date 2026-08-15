import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Text input in the design's search-row clothing: bordered container
 * (radius 11, padding 11×14) with optional leading icon and trailing slot,
 * borderless input inside. Focus ring lands on the container.
 */
export function Input({
  icon,
  trailing,
  containerClassName,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode;
  trailing?: ReactNode;
  containerClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-[10px] rounded-[11px] border border-line bg-white px-[14px] py-[11px]",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-tangerine-300",
        containerClassName,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="flex text-[16px] text-oat-400">
          {icon}
        </span>
      )}
      <input
        className={cn(
          "min-w-0 flex-1 border-0 bg-transparent font-body text-[14px] text-oat-500 outline-none placeholder:text-oat-400",
          className,
        )}
        {...rest}
      />
      {trailing}
    </div>
  );
}
