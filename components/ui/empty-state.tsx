import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/ui/cn";

/**
 * Empty state per the design: claymation icon, display title, muted body,
 * and always an action — every empty state in this product has one.
 */
export function EmptyState({
  icon,
  iconSize = 110,
  title,
  body,
  action,
  className,
}: {
  /** Path under /public, e.g. "/brand/icons/Update-CRM.png". */
  icon: string;
  iconSize?: number;
  title: string;
  body: string;
  action: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-[6px] rounded-[20px] border border-line bg-white px-6 py-[70px] text-center",
        className,
      )}
    >
      <Image
        src={icon}
        alt=""
        width={iconSize}
        height={iconSize}
        className="mb-[14px] object-contain"
        style={{ width: iconSize, height: iconSize }}
      />
      <div className="t-display text-[20px] font-medium tracking-[-0.015em]">{title}</div>
      <p className="m-0 mb-5 max-w-[400px] text-[14.5px] text-oat-400" style={{ textWrap: "pretty" }}>
        {body}
      </p>
      {action}
    </div>
  );
}
