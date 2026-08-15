"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  DownloadSimple,
  HourglassMedium,
  TrafficCone,
  UploadSimple,
} from "@phosphor-icons/react";
import { Banner } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChunkTrack, type ChunkCell } from "@/components/ui/chunk-track";
import { ProgressDisplay, flooredPercent } from "@/components/ui/progress-display";
import { RunStatusPill, StatusPill, type RunStatusKey } from "@/components/ui/status-pill";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { ResultRowView, RunView } from "@/lib/runs/types";
import { fmtAgo, fmtElapsed, fmtInt } from "@/lib/ui/format";

const TERMINAL = new Set(["complete", "completed_with_failures", "validation_failed", "failed", "expired"]);

function statusKey(view: RunView): RunStatusKey {
  if (view.status === "completed_with_failures") return "completed_with_failures";
  if (view.status === "complete") return "complete";
  if (view.status === "validation_failed") return "validation_failed";
  if (view.status === "failed" || view.status === "expired") return "completed_with_failures";
  if (view.stalled) return "stalled";
  if (view.status === "queued" || view.status === "draft") return "queued";
  if (view.status === "uploading") return "uploading";
  if (view.status === "validating") return "validating";
  if (view.status === "finalizing") return "finalizing";
  return "running";
}

const PHASE_HINTS: Record<string, string> = {
  queued: "Waiting for a worker — usually seconds.",
  uploading: "Sending your file to Clay.",
  validating: "Clay is checking every row before spending credits.",
  running: "Enriching in chunks of 100 — rows land below as each completes.",
  finalizing: "Wrapping up the last writes to Salesforce.",
};

function fmtStarted(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${month} ${d.getFullYear()} at ${time}`;
}

export function RunMonitor({ initial, initialRows }: { initial: RunView; initialRows: ResultRowView[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [view, setView] = useState<RunView>(initial);
  const [rows, setRows] = useState<ResultRowView[]>(initialRows);
  const [rowTotal, setRowTotal] = useState(initialRows.length);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());
  const [retrying, setRetrying] = useState(false);
  const samples = useRef<Array<{ t: number; finished: number }>>([]);
  const lastAnnounced = useRef(0);
  const [announce, setAnnounce] = useState("");
  const freshChunkRef = useRef<number | null>(null);

  const terminal = TERMINAL.has(view.status);
  const rateLimited = Boolean(view.rateLimitedUntil && new Date(view.rateLimitedUntil) > new Date(now));

  const fetchRows = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/results`);
      if (!res.ok) return;
      const body = (await res.json()) as { total: number; rows: ResultRowView[] };
      setRows((prev) => {
        const prevMaxChunk = prev.reduce((m, r) => Math.max(m, r.chunkIndex ?? -1), -1);
        const newMaxChunk = body.rows.reduce((m, r) => Math.max(m, r.chunkIndex ?? -1), -1);
        freshChunkRef.current = newMaxChunk > prevMaxChunk ? newMaxChunk : null;
        return body.rows;
      });
      setRowTotal(body.total);
    } catch {
      /* rows refresh is best-effort */
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${view.id}`);
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as RunView;
      setOffline(false);
      setUpdatedAt(Date.now());
      setView((prev) => {
        if (fresh.finishedRows !== prev.finishedRows) {
          samples.current.push({ t: Date.now(), finished: fresh.finishedRows });
          if (samples.current.length > 30) samples.current.shift();
          if (fresh.finishedRows - lastAnnounced.current >= 100 || TERMINAL.has(fresh.status)) {
            lastAnnounced.current = fresh.finishedRows;
            setAnnounce(
              TERMINAL.has(fresh.status)
                ? `Run complete. ${fmtInt(fresh.writtenRows)} of ${fmtInt(fresh.effectiveRows)} rows written to Salesforce.`
                : `${fmtInt(fresh.finishedRows)} of ${fmtInt(fresh.effectiveRows)} rows processed.`,
            );
          }
          void fetchRows(fresh.id);
        }
        return fresh;
      });
    } catch {
      setOffline(true);
    }
  }, [view.id, fetchRows]);

  // Client polling: 2s while running, 10s when degraded, STOP on terminal.
  useEffect(() => {
    if (terminal) return;
    const degraded = offline || rateLimited || view.stalled;
    const interval = window.setInterval(poll, degraded ? 10_000 : 2_000);
    return () => window.clearInterval(interval);
  }, [terminal, offline, rateLimited, view.stalled, poll]);

  // Local ticker for elapsed / updated / countdowns.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (terminal) void fetchRows(view.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal]);

  /* ── honest throughput + ETA (the prototype's exact gating) ── */
  const elapsedSec = view.startedAt ? Math.max(0, (now - new Date(view.startedAt).getTime()) / 1000) : 0;
  const { rateText, etaText } = useMemo(() => {
    const s = samples.current;
    if (view.status !== "running" || view.stalled || rateLimited || offline || s.length < 2 || elapsedSec < 4) {
      return { rateText: undefined, etaText: undefined };
    }
    const first = s[0];
    const last = s[s.length - 1];
    const dtMin = (last.t - first.t) / 60_000;
    if (dtMin <= 0 || last.finished <= first.finished) return { rateText: undefined, etaText: undefined };
    const rate = Math.round((last.finished - first.finished) / dtMin / 10) * 10;
    if (rate <= 0) return { rateText: undefined, etaText: undefined };
    const pct = view.effectiveRows ? view.finishedRows / view.effectiveRows : 0;
    if (pct <= 0.08 || elapsedSec <= 6) return { rateText: fmtInt(rate), etaText: undefined };
    const etaMin = Math.max(1, Math.ceil((view.effectiveRows - view.finishedRows) / rate));
    return { rateText: fmtInt(rate), etaText: etaMin <= 1 ? "< 1 min" : `≈ ${etaMin} min` };
  }, [view, now, rateLimited, offline, elapsedSec]);

  const chunkCells: ChunkCell[] = view.chunks.map((c) => ({
    index: c.index + 1,
    state: c.status === "complete" ? "done" : c.status === "failed" ? "failed" : c.status === "queued" ? "queued" : "running",
    finished: c.finished,
    size: c.rowCount,
  }));

  const agoSec = Math.round((now - updatedAt) / 1000);
  const successRate = view.finishedRows > 0 ? (view.writtenRows / view.finishedRows) * 100 : null;
  const retryInSec = view.rateLimitedUntil
    ? Math.max(0, Math.round((new Date(view.rateLimitedUntil).getTime() - now) / 1000))
    : 0;

  async function retryFailed() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/runs/${view.id}/retry`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "retry failed");
      router.push(`/runs/${body.runId}`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Retry didn't start", "error");
      setRetrying(false);
    }
  }

  async function retryStuck() {
    const res = await fetch(`/api/runs/${view.id}/retry-stuck`, { method: "POST" });
    if (res.ok) {
      toast("Retrying stuck chunks — rows already written aren't touched.", "info");
      void poll();
    } else toast("Couldn't retry right now.", "error");
  }

  /* ── batch validation failure gets its own designed screen ── */
  if (view.status === "validation_failed") {
    const details = view.validationErrors ?? [];
    const total = view.validationTotalInvalid ?? details.length;
    return (
      <main className="mx-auto max-w-[860px] px-6 pb-[130px] pt-9">
        <Link href="/runs" className="mb-[14px] inline-flex items-center gap-[5px] text-[12.5px] text-oat-400 hover:text-oat-500">
          <ArrowLeft aria-hidden="true" size={13} /> Run history
        </Link>
        <div className="mb-[10px] flex flex-wrap items-center gap-3">
          <h1 className="t-display m-0 text-[28px] tracking-[-0.02em]" style={{ fontWeight: 525 }}>
            Clay rejected this file before the run started
          </h1>
          <RunStatusPill status="validation_failed" />
        </div>
        <p className="m-0 mb-[26px] max-w-[640px] text-[15px] leading-relaxed text-oat-400" style={{ textWrap: "pretty" }}>
          <span className="font-medium text-oat-500">
            {fmtInt(total)} rows in {view.fileName} didn&rsquo;t validate
          </span>
          , so nothing ran and no credits were spent. Fix the rows below in your spreadsheet, then upload the corrected
          file.
        </p>

        <Card className="mb-[18px] overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 bg-oat-200 px-5 py-[14px]">
            <span className="t-mono-label">
              Showing {fmtInt(Math.min(100, details.length))} of {fmtInt(total)} errors
            </span>
            <span className="text-[12.5px] text-oat-400">Clay returns detail for the first 100 lines — the CSV export has the full count.</span>
            <div className="flex-1" />
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<DownloadSimple size={14} />}
              onClick={() => {
                const csv =
                  "line,field,message\n" +
                  details.map((e) => `${e.line},${e.field},"${e.message.replace(/"/g, '""')}"`).join("\n") +
                  `\n"— Clay reported ${total} invalid rows in total; detail is capped at 100."`;
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                a.download = `${view.fileName.replace(/\.csv$/i, "")}-validation-errors.csv`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              }}
            >
              Download all {fmtInt(total)}
            </Button>
          </div>
          <TableScroll maxHeight={420}>
            <Table minWidth={560}>
              <thead>
                <tr>
                  <Th className="w-[60px] bg-oat-100 text-right">Line</Th>
                  <Th className="w-[110px] bg-oat-100">Field</Th>
                  <Th className="bg-oat-100">What&rsquo;s wrong</Th>
                </tr>
              </thead>
              <tbody>
                {details.map((e, i) => (
                  <tr key={i}>
                    <Td className="t-mono tnum text-right text-[12px] text-oat-400">{e.line}</Td>
                    <Td>
                      <StatusPill tone="oat" size="xs">
                        {e.field}
                      </StatusPill>
                    </Td>
                    <Td className="whitespace-normal text-oat-500">{e.message}</Td>
                  </tr>
                ))}
                {total > details.length && (
                  <tr>
                    <Td colSpan={3} className="t-mono text-[11.5px] text-oat-400">
                      … {fmtInt(total - details.length)} more in the download
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
        <div className="flex flex-wrap gap-[10px]">
          <Button variant="primary" size="lg" iconLeft={<UploadSimple size={15} weight="bold" />} onClick={() => router.push("/runs/new")}>
            Upload the fixed file
          </Button>
        </div>
      </main>
    );
  }

  const shownRows = rows.slice(0, 250);
  const done = view.status === "complete" || view.status === "completed_with_failures";
  const hardFailed = view.status === "failed" || view.status === "expired";

  return (
    <main className="mx-auto max-w-[1020px] px-6 pb-[130px] pt-7">
      {/* header */}
      <div className="mb-2 flex flex-wrap items-start gap-4">
        <div className="min-w-[260px] flex-1">
          <Link href="/runs" className="mb-[10px] inline-flex items-center gap-[5px] text-[12.5px] text-oat-400 hover:text-oat-500">
            <ArrowLeft aria-hidden="true" size={13} /> Run history
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="t-display m-0 text-[28px] leading-none tracking-[-0.02em]" style={{ fontWeight: 525 }}>
              {view.runName}
            </h1>
            <RunStatusPill status={statusKey(view)} />
          </div>
          <div className="t-mono mt-[10px] flex flex-wrap gap-[18px] text-[12px] text-oat-400">
            <span>{view.fileName}</span>
            {view.campaignUrl ? (
              <a href={view.campaignUrl} target="_blank" rel="noreferrer" className="text-tangerine-400">
                {view.campaignName} <ArrowSquareOut aria-hidden="true" size={11} className="inline" />
              </a>
            ) : (
              <span>{view.campaignName}</span>
            )}
            <span>Started {fmtStarted(view.startedAt ?? view.createdAt)}</span>
            {!done && !hardFailed && <span className="tnum">Elapsed {fmtElapsed(elapsedSec)}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-[6px] text-right">
          <Button variant="secondary" size="sm" iconLeft={<ArrowsClockwise size={14} />} onClick={() => void poll()}>
            Refresh
          </Button>
          <span className={`t-mono tnum text-[11px] ${agoSec > 15 ? "text-pom-400" : "text-oat-400"}`}>
            Updated {fmtAgo(agoSec)}
          </span>
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {announce}
      </div>

      {/* banners */}
      {view.stalled && !terminal && (
        <Banner
          tone="warning"
          className="mt-4"
          icon={<HourglassMedium size={20} />}
          title="Nothing has moved for a while"
          body="A chunk appears stuck. Retrying won't touch the rows already written."
          action={
            <Button variant="dark" onClick={retryStuck}>
              Retry stuck chunks
            </Button>
          }
        />
      )}
      {rateLimited && !terminal && (
        <Banner
          tone="info"
          className="mt-4"
          icon={<TrafficCone size={20} />}
          title="Clay asked us to slow down"
          body="Rate limited — the run pauses and resumes on its own. Nothing is lost."
          action={<span className="t-mono tnum text-[12px] font-semibold text-blueberry-500">Resuming in {retryInSec}s</span>}
        />
      )}
      {offline && !terminal && (
        <Banner
          tone="neutral"
          className="mt-4"
          icon={<span aria-hidden="true" className="block size-2 rounded-full bg-pom-300" style={{ animation: "dotBlink 1.2s infinite" }} />}
          title="Connection lost — retrying"
          body={`The numbers below are from ${fmtAgo(agoSec)}. The run itself keeps going on Clay's side.`}
          action={
            <Button variant="secondary" onClick={() => void poll()}>
              Try now
            </Button>
          }
        />
      )}
      {hardFailed && (
        <Banner
          tone="danger"
          className="mt-4"
          role="alert"
          icon={<TrafficCone size={20} />}
          title="This run didn't finish"
          body={view.error ?? "Something went wrong on Clay's side. Rows already written are safe."}
          action={
            <Button variant="secondary" onClick={() => router.push("/runs/new")}>
              Start a new run
            </Button>
          }
        />
      )}

      {/* progress / summary */}
      {!done && !hardFailed && (
        <Card radius={20} className="mt-[18px] px-8 pb-[26px] pt-[30px]">
          <ProgressDisplay
            percent={flooredPercent(view.finishedRows, view.effectiveRows)}
            processedText={`${fmtInt(view.finishedRows)} of ${fmtInt(view.effectiveRows)} rows`}
            phaseHint={
              view.stalled
                ? "Paused — see the notice above."
                : rateLimited
                  ? "Paused while Clay backs off."
                  : offline
                    ? "Last known state — reconnecting."
                    : PHASE_HINTS[view.status] ?? ""
            }
            rateText={rateText}
            etaText={etaText}
          />
          {view.mode === "inline" && chunkCells.length > 0 && (
            <ChunkTrack className="mt-5" chunks={chunkCells} paused={view.stalled || rateLimited || offline} />
          )}
          {view.mode === "batch" && (
            <p className="t-mono mb-0 mt-5 text-[11.5px] text-oat-400">
              Batch mode: Clay reports progress counters while it runs and returns all rows at the end.
            </p>
          )}
        </Card>
      )}

      {done && (
        <Card radius={20} className="mt-[18px] px-8 py-[30px]">
          <div className="flex flex-wrap items-center gap-7">
            <Image src="/brand/icons/Check-A.png" alt="" width={84} height={84} className="size-[84px] object-contain" />
            <div className="min-w-[240px] flex-1">
              <div className="flex items-baseline gap-3">
                <span className="t-display tnum leading-[0.9] tracking-[-0.04em]" style={{ fontSize: "clamp(52px, 7vw, 80px)", fontWeight: 525 }}>
                  {successRate === null ? "—" : `${successRate.toFixed(1)}%`}
                </span>
                <span className="t-mono-label text-[12px]">success rate</span>
              </div>
              <p className="m-0 mt-3 text-[15px]" style={{ textWrap: "pretty" }}>
                {fmtInt(view.writtenRows)} of {fmtInt(view.effectiveRows)} people written to {view.campaignName}. That&rsquo;s
                the number for your leadership update.
              </p>
              <p className="t-mono tnum m-0 mt-[6px] text-[12px] text-oat-400">
                {fmtInt(view.failedRows)} failed · {fmtInt(view.skippedRows)} skipped (already in campaign) · finished in{" "}
                {fmtElapsed(view.startedAt && view.finishedAt ? (new Date(view.finishedAt).getTime() - new Date(view.startedAt).getTime()) / 1000 : 0)}
              </p>
            </div>
            <div className="flex min-w-[230px] flex-col items-stretch gap-[9px]">
              {view.failedRows > 0 && (
                <Button variant="primary" iconLeft={<ArrowCounterClockwise size={15} weight="bold" />} disabled={retrying} onClick={retryFailed}>
                  {retrying ? "Starting retry…" : `Retry ${fmtInt(view.failedRows)} failed rows`}
                </Button>
              )}
              <a href={`/api/runs/${view.id}/export`} className="contents">
                <Button variant="secondary" iconLeft={<DownloadSimple size={15} />} className="w-full">
                  Export results CSV
                </Button>
              </a>
              <div className="flex gap-[9px]">
                {view.failedRows > 0 && (
                  <a href={`/api/runs/${view.id}/export?filter=failed`} className="flex-1">
                    <Button variant="secondary" size="sm" className="w-full">
                      Failures only
                    </Button>
                  </a>
                )}
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => router.push("/runs/new")}>
                  Run another
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* stat tiles */}
      <div className="mt-[14px] grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        <StatTile label="Total" value={view.effectiveRows} />
        <StatTile label="Succeeded" value={view.writtenRows} />
        <StatTile label="Failed" value={view.failedRows} danger={view.failedRows > 0} />
        <StatTile label="Skipped" value={view.skippedRows} />
        <StatTile label="Success rate" value={successRate === null ? "—" : `${successRate.toFixed(1)}%`} />
      </div>

      {/* failures by cause */}
      {view.failureGroups.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="t-mono-label mr-[2px]">Failures by cause</span>
          {view.failureGroups.map((g) => (
            <span key={g.label} className="t-mono inline-flex items-center gap-[7px] rounded-pill bg-pom-100 px-3 py-[7px] text-[12px] font-medium text-pom-400">
              <span className="tnum font-semibold">{fmtInt(g.count)}</span>
              {g.label}
            </span>
          ))}
        </div>
      )}

      {/* results table */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-baseline gap-[10px] px-5 pb-3 pt-4">
          <h2 className="t-display m-0 text-[16px] font-medium tracking-[-0.01em]">Results</h2>
          <span className="t-mono tnum text-[11.5px] text-oat-400">
            {rowTotal === 0
              ? "Waiting on the first chunk"
              : rowTotal > 250
                ? `Showing the latest 250 of ${fmtInt(rowTotal)} — the export has every row`
                : `${fmtInt(rowTotal)} rows in`}
          </span>
        </div>
        <TableScroll maxHeight={460}>
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th stickyLeft className="px-5">Name</Th>
                <Th>Line</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
                <Th className="pl-[14px] pr-5">Salesforce</Th>
              </tr>
            </thead>
            <tbody>
              {shownRows.length === 0 && (
                <tr>
                  <Td colSpan={6} className="whitespace-normal px-5 py-[34px]">
                    <SkeletonRows note="Rows land here in batches as each chunk completes — the first batch is on its way." />
                  </Td>
                </tr>
              )}
              {shownRows.map((r, i) => {
                const fresh = !terminal && r.chunkIndex !== null && r.chunkIndex === freshChunkRef.current;
                return (
                  <tr key={r.id} style={fresh ? { animation: `rowIn .5s cubic-bezier(.2,0,0,1) both ${Math.min(i * 14, 500)}ms` } : undefined}>
                    <Td stickyLeft className="px-5 font-medium">{r.name || "—"}</Td>
                    <Td className="t-mono tnum text-[12px] text-oat-400">{r.originalRowNumber}</Td>
                    <Td className="t-mono text-[12px] text-oat-400">{r.email || "—"}</Td>
                    <Td className="t-mono tnum text-[12px] text-oat-400">{r.phone || "—"}</Td>
                    <Td>
                      {r.status === "written" && <StatusPill tone="lime" size="xs" fgOverride="lime-450">Written</StatusPill>}
                      {r.status === "failed" && <StatusPill tone="pom" size="xs">Failed</StatusPill>}
                      {r.status === "skipped" && <StatusPill tone="lemon" size="xs" fgOverride="lemon-400">Skipped</StatusPill>}
                      {r.reason && <span className="ml-2 text-[12px] text-oat-400">{r.reason}</span>}
                    </Td>
                    <Td className="pl-[14px] pr-5">
                      {r.salesforceUrl ? (
                        <a href={r.salesforceUrl} target="_blank" rel="noreferrer" className="t-mono text-[12px] text-tangerine-400">
                          View <ArrowSquareOut aria-hidden="true" size={11} className="inline" />
                        </a>
                      ) : (
                        <span className="text-oat-300">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableScroll>
      </Card>

      {!done && !hardFailed && view.retryOfRunId && (
        <p className="t-mono mt-3 text-[11.5px] text-oat-400">
          This run retries the failures of an earlier run.{" "}
          <Link href={`/runs/${view.retryOfRunId}`} className="text-tangerine-400">
            View the original <ArrowRight aria-hidden="true" size={10} className="inline" />
          </Link>
        </p>
      )}
    </main>
  );
}
