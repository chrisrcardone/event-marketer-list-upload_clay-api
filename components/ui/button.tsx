import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/ui/cn";

type Variant = "primary" | "dark" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  // Tangerine CTA — ink is tangerine-500 per the prototype, hover one step darker.
  primary:
    "border-0 bg-tangerine-300 text-tangerine-500 hover:bg-tangerine-350",
  // Ink pill — hover drops opacity, per the prototype.
  dark: "border-0 bg-oat-500 text-oat-100 hover:opacity-90",
  // White pill with strong hairline.
  secondary:
    "border border-oat-300 bg-white text-oat-500 hover:bg-oat-200",
  // Quiet pill that fills on hover (top-bar nav, Drop/Keep inactive).
  ghost: "border-0 bg-transparent text-oat-500 hover:bg-oat-200",
};

const sizeClasses: Record<Size, string> = {
  sm: "text-[12.5px] px-[15px] py-[8px] gap-[6px]",
  md: "text-[13.5px] px-[18px] py-[9px] gap-[7px]",
  lg: "text-[15px] px-[26px] py-[12px] gap-[8px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  /**
   * Why the button is disabled, shown as quiet text beside the button and
   * wired via aria-describedby. Rendered only while `disabled` is true —
   * the design never disables a control without saying why.
   */
  disabledReason?: string;
}

export function Button({
  variant = "secondary",
  size = "md",
  iconLeft,
  iconRight,
  disabledReason,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const showReason = Boolean(disabled && disabledReason);

  const button = (
    <button
      type={type}
      disabled={disabled}
      aria-describedby={showReason ? reasonId : undefined}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-pill font-display font-medium tracking-[-0.01em] transition-[background,opacity] duration-[120ms] ease-house disabled:cursor-not-allowed disabled:opacity-40",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );

  if (!showReason) return button;
  return (
    <span className="inline-flex flex-wrap items-center gap-[14px]">
      <span id={reasonId} className="text-[12.5px] font-medium text-tangerine-400">
        {disabledReason}
      </span>
      {button}
    </span>
  );
}
