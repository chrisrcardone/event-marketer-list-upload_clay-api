import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, Td, Th } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { fmtInt } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Run history" };
export const dynamic = "force-dynamic";

interface HistoryRow {
  id: string;
  created_at: string;
  run_name: string;
  file_name: string;
  campaign_name: string;
  status: string;
  effective_rows: number;
  written_rows: number;
  finished_rows: number;
}

const STATUS_PILLS: Record<string, { label: string; tone: "lime" | "lemon" | "pom" | "oat" | "blueberry"; fg?: "oat-400" }> = {
  complete: { label: "Complete", tone: "lime" },
  completed_with_failures: { label: "Completed with failures", tone: "lemon" },
  validation_failed: { label: "Validation failed", tone: "pom" },
  failed: { label: "Failed", tone: "pom" },
  expired: { label: "Expired", tone: "oat", fg: "oat-400" },
  running: { label: "Running", tone: "lime" },
  finalizing: { label: "Finalizing", tone: "lime" },
  queued: { label: "Queued", tone: "oat" },
  uploading: { label: "Uploading", tone: "blueberry" },
  validating: { label: "Validating", tone: "blueberry" },
  draft: { label: "Draft", tone: "oat", fg: "oat-400" },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `Today, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  }
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()}`;
}

export default async function RunHistoryPage() {
  let runs: HistoryRow[] = [];
  if (isSupabaseConfigured()) {
    await requireUser();
    const supabase = await createClient();
    const { data } = await supabase
      .from("runs")
      .select("id, created_at, run_name, file_name, campaign_name, status, effective_rows, written_rows, finished_rows")
      .order("created_at", { ascending: false })
      .limit(100);
    runs = (data as HistoryRow[]) ?? [];
  }

  return (
    <main className="mx-auto max-w-[1020px] px-6 pb-[130px] pt-9">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <div className="t-eyebrow-sm mb-[10px]">Your runs</div>
          <h1 className="t-display m-0 text-[32px] leading-none tracking-[-0.025em]" style={{ fontWeight: 525 }}>
            Run history
          </h1>
        </div>
        <div className="flex-1" />
        {runs.length > 0 && (
          <Link
            href="/runs/new"
            className="inline-flex items-center gap-[7px] rounded-pill bg-oat-500 px-[22px] py-[11px] font-display text-[14px] font-medium text-oat-100 transition-opacity duration-[120ms] hover:opacity-90 hover:no-underline"
          >
            <Plus aria-hidden="true" size={14} />
            New run
          </Link>
        )}
      </div>

      {runs.length === 0 ? (
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
      ) : (
        <section className="overflow-hidden rounded-lg border border-line bg-white">
          <div className="overflow-x-auto">
            <Table minWidth={820} className="text-[13.5px]">
              <thead>
                <tr>
                  <Th className="px-5">Date</Th>
                  <Th>File</Th>
                  <Th>Campaign</Th>
                  <Th className="text-right">Rows</Th>
                  <Th className="text-right">Success</Th>
                  <Th className="pl-[14px] pr-5">Status</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const pill = STATUS_PILLS[run.status] ?? STATUS_PILLS.queued;
                  const rate =
                    run.status === "validation_failed" || run.finished_rows === 0
                      ? "—"
                      : `${((run.written_rows / Math.max(1, run.finished_rows)) * 100).toFixed(1)}%`;
                  return (
                    <tr key={run.id} className="group relative hover:bg-row-hover">
                      <Td className="t-mono px-5 text-[12px] text-oat-400">{fmtDate(run.created_at)}</Td>
                      <Td className="t-mono text-[12.5px]">
                        <Link href={`/runs/${run.id}`} className="after:absolute after:inset-0" aria-label={`${run.file_name}, ${run.campaign_name}, ${pill.label}`}>
                          {run.file_name}
                        </Link>
                      </Td>
                      <Td className="font-medium">{run.campaign_name}</Td>
                      <Td className="t-mono tnum text-right text-[12.5px]">{fmtInt(run.effective_rows)}</Td>
                      <Td className={`t-mono tnum text-right text-[12.5px] ${rate === "—" ? "text-oat-400" : ""}`}>{rate}</Td>
                      <Td className="pl-[14px] pr-5">
                        <StatusPill tone={pill.tone} size="xs" fgOverride={pill.fg}>
                          {pill.label}
                        </StatusPill>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </section>
      )}
    </main>
  );
}
