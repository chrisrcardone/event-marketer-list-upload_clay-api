import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Inline notice banner, in the design's four voices:
 *   warning  — lemon   (stalled run, over-limit file)
 *   info     — blueberry (rate-limited)
 *   neutral  — oat     (connection lost)
 *   danger   — pom     (validation failure lede chip contexts)
 * Every instance carries a plain-language cause and a recovery path —
 * `action` is where the recovery control goes. Status is never color-alone:
 * the icon + title carry it too.
 */
export type BannerTone = "warning" | "info" | "neutral" | "danger";

const toneClasses: Record<
  BannerTone,
  { box: string; title: string; body: string; icon: string }
> = {
  warning: {
    box: "border-lemon-200 bg-lemon-100",
    title: "text-lemon-500",
    body: "text-lemon-400",
    icon: "text-lemon-400",
  },
  info: {
    box: "border-blueberry-200 bg-blueberry-100",
    title: "text-blueberry-500",
    body: "text-blueberry-400",
    icon: "text-blueberry-400",
  },
  neutral: {
    box: "border-oat-300 bg-oat-200",
    title: "text-oat-500",
    body: "text-oat-400",
    icon: "text-oat-400",
  },
  danger: {
    box: "border-pom-200 bg-pom-100",
    title: "text-pom-500",
    body: "text-pom-400",
    icon: "text-pom-400",
  },
};

export function Banner({
  tone,
  icon,
  title,
  body,
  action,
  role = "status",
  className,
}: {
  tone: BannerTone;
  /** A 20px Phosphor icon (or any 20px marker, e.g. the blinking offline dot). */
  icon: ReactNode;
  title: string;
  body: ReactNode;
  /** Recovery control (button) or live detail (countdown). */
  action?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  const t = toneClasses[tone];
  return (
    <div
      role={role}
      className={cn(
        "flex flex-wrap items-center gap-[14px] rounded-[14px] border px-5 py-4",
        t.box,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("flex text-[20px]", t.icon)}>
        {icon}
      </span>
      <div className="min-w-[240px] flex-1">
        <div className={cn("text-[14px] font-medium", t.title)}>{title}</div>
        <div className={cn("text-[13px]", t.body)} style={{ textWrap: "pretty" }}>
          {body}
        </div>
      </div>
      {action}
    </div>
  );
}
