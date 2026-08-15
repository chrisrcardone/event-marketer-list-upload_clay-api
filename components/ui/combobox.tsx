"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { cn } from "@/lib/ui/cn";
import { fmtInt, truncateSfId } from "@/lib/ui/format";
import { StatusPill } from "@/components/ui/status-pill";

export interface CampaignOption {
  /** Full Salesforce campaign record id. */
  id: string;
  name: string;
  /** Campaign type, e.g. "Conference", "Event". */
  type: string;
  status: "Active" | "Completed";
  members: number;
}

export { looksLikeSalesforceId } from "@/lib/ui/salesforce-id";

/**
 * Campaign search combobox per the design: bordered search row with leading
 * magnifier, inline listbox (not a floating popover) listing multi-matches
 * with name, type · truncated id, status pill, and members; a lime "Found"
 * pill in the row once a campaign is resolved. Full keyboard support
 * (arrows / Enter / Escape / Home / End) with aria-activedescendant.
 *
 * The component is controlled and data-agnostic: the caller supplies
 * `matches` for the current query (Phase 5 wires this to the Salesforce
 * lookup, including id-paste detection via looksLikeSalesforceId).
 */
export function CampaignCombobox({
  query,
  onQueryChange,
  matches,
  open,
  selected,
  onSelect,
  placeholder = "Campaign name or Salesforce ID",
  className,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  matches: CampaignOption[];
  /** Whether the multi-match list is shown (caller decides, e.g. >1 match and nothing selected). */
  open: boolean;
  selected: CampaignOption | null;
  onSelect: (option: CampaignOption) => void;
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active >= matches.length) setActive(0);
  }, [matches.length, active]);

  const optionId = (i: number) => `${listId}-opt-${i}`;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(matches.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSelect(matches[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onQueryChange("");
    }
  }

  return (
    <div className={className}>
      <div
        className={cn(
          "mb-[14px] flex items-center gap-[10px] rounded-[11px] border border-line bg-white px-[14px] py-[11px]",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-tangerine-300",
        )}
      >
        <MagnifyingGlass aria-hidden="true" size={16} className="shrink-0 text-oat-400" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && matches.length > 0 ? optionId(active) : undefined}
          aria-label={placeholder}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent font-body text-[14px] text-oat-500 outline-none placeholder:text-oat-400"
        />
        {selected && (
          <StatusPill tone="lime" size="sm">
            Found
          </StatusPill>
        )}
      </div>

      {open && (
        <div
          role="listbox"
          id={listId}
          aria-label={`${matches.length} campaigns match`}
          className="overflow-hidden rounded-md border border-line shadow-md"
        >
          <div className="t-mono-label bg-oat-200 px-4 py-[10px]">
            {fmtInt(matches.length)} campaigns match &ldquo;{query}&rdquo; — pick one
          </div>
          {matches.map((m, i) => (
            <div
              key={m.id}
              id={optionId(i)}
              role="option"
              aria-selected={selected?.id === m.id}
              tabIndex={-1}
              onClick={() => onSelect(m)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer flex-wrap items-center gap-3 border-t border-line-soft bg-white px-4 py-[13px]",
                i === active && "bg-oat-200",
              )}
            >
              <div className="min-w-[180px] flex-1">
                <div className="text-[14px] font-medium">{m.name}</div>
                <div className="t-mono text-[11.5px] text-oat-400">
                  {m.type} · {truncateSfId(m.id)}
                </div>
              </div>
              <StatusPill
                tone={m.status === "Active" ? "lime" : "oat"}
                size="sm"
                fgOverride={m.status === "Active" ? undefined : "oat-400"}
              >
                {m.status}
              </StatusPill>
              <span className="t-mono tnum text-[11.5px] text-oat-400">
                {fmtInt(m.members)} members
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
