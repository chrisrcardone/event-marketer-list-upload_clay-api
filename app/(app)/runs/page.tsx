import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Run history" };

/**
 * Run history. Phase 1 ships the designed empty state (there are no runs
 * yet — that's true); Phase 5 adds the populated table view on top of real
 * run data.
 */
export default function RunHistoryPage() {
  return (
    <main className="mx-auto max-w-[1020px] px-6 pb-[130px] pt-9">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <div className="t-eyebrow-sm mb-[10px]">Your runs</div>
          <h1
            className="t-display m-0 text-[32px] leading-none tracking-[-0.025em]"
            style={{ fontWeight: 525 }}
          >
            Run history
          </h1>
        </div>
      </div>

      <EmptyState
        icon="/brand/icons/Update-CRM.png"
        title="No runs yet"
        body="Upload a badge-scan CSV and Event Lead Router enriches every person and writes them into a Salesforce campaign — with receipts."
        action={
          <Link
            href="/runs/new"
            className="inline-flex items-center gap-2 rounded-pill bg-tangerine-300 px-[26px] py-3 font-display text-[15px] font-medium tracking-[-0.01em] text-tangerine-500 transition-colors duration-[120ms] hover:bg-tangerine-350 hover:no-underline"
          >
            Start your first run
            <ArrowRight aria-hidden="true" size={15} weight="bold" />
          </Link>
        }
      />
    </main>
  );
}
