"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/ui/cn";
import { DemoPill } from "@/components/ui/demo-pill";

export interface ShellUser {
  name: string;
  email: string;
}

function initials(user: ShellUser): string {
  const parts = user.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return user.email.slice(0, 2).toUpperCase();
}

/**
 * The signed-in top bar: sticky, frosted cream, arch + product name +
 * required Demo pill, ghost nav (Run history / New run), ink New-run CTA,
 * and the initials avatar. Sign-in and rejected-domain screens render no
 * top bar at all (they omit this component).
 */
export function TopBar({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  const isHistory = pathname === "/runs" || /^\/runs\/(?!new).+/.test(pathname);
  const isNewRun = pathname === "/runs/new";

  return (
    <header className="sticky top-0 z-40 flex h-[60px] items-center gap-5 border-b border-hairline bg-[rgba(254,253,251,.86)] px-6 backdrop-blur-[12px]">
      <div className="flex items-center gap-[10px]">
        <Image
          src="/brand/Clay_Arch_3D.png"
          alt="Clay"
          width={24}
          height={24}
          className="size-6 object-contain"
          priority
        />
        <span className="t-display whitespace-nowrap text-[16px] font-medium tracking-[-0.01em]">
          Event Lead Router
        </span>
        <DemoPill />
      </div>
      <nav aria-label="Primary" className="ml-2 flex items-center gap-1 max-sm:hidden">
        <NavPill href="/runs" active={isHistory}>
          Run history
        </NavPill>
        <NavPill href="/runs/new" active={isNewRun}>
          New run
        </NavPill>
      </nav>
      <div className="flex-1" />
      <Link
        href="/runs/new"
        className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-pill bg-oat-500 px-[18px] py-[9px] font-display text-[13.5px] font-medium tracking-[-0.01em] text-oat-100 transition-opacity duration-[120ms] hover:opacity-90 hover:no-underline"
      >
        <Plus aria-hidden="true" size={14} />
        New run
      </Link>
      <div
        aria-label={`Signed in as ${user.name}`}
        title={user.email}
        className="t-mono flex size-8 items-center justify-center rounded-[10px] border border-hairline bg-oat-200 text-[11px] font-semibold text-oat-400"
      >
        {initials(user)}
      </div>
    </header>
  );
}

function NavPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-pill px-[14px] py-[7px] font-display text-[13.5px] font-medium text-oat-500 transition-colors duration-[120ms] hover:bg-oat-200 hover:no-underline",
        active && "bg-oat-200",
      )}
    >
      {children}
    </Link>
  );
}
