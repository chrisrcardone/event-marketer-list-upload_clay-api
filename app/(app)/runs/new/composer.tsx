"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, FileCsv, Scissors } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { CampaignCombobox, type CampaignOption } from "@/components/ui/combobox";
import { Card, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { parseCsv, type ParsedCsv } from "@/lib/csv/parse";
import {
  autoMapHeaders,
  FIELD_LABELS,
  IDENTITY_FIELDS,
  type MappableField,
} from "@/lib/csv/synonyms";
import { extractLeads, preflight, type DropChoices } from "@/lib/csv/validate";
import { estimate } from "@/lib/runs/plan";
import { fmtInt, truncateSfId } from "@/lib/ui/format";
import { ArrowSquareOut, CheckCircle } from "@phosphor-icons/react";

const MAX_ROWS = 50000;
const NOT_MAPPED = "Not mapped";
const FIELDS = Object.keys(FIELD_LABELS) as MappableField[];

interface MemberStatus {
  label: string | null;
  is_default: boolean;
  has_responded: boolean;
}
type CampaignMatch = CampaignOption & { member_statuses: MemberStatus[]; is_active?: boolean; url?: string };

export function NewRunComposer() {
  const router = useRouter();
  const { toast } = useToast();

  // ── file state (client parse is preview-only; the server re-parses) ──
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // ── mapping + pre-flight ──
  const [mapping, setMapping] = useState<Partial<Record<MappableField, string>>>({});
  const [drops, setDrops] = useState<DropChoices>({ unidentified: true, malformed: true, duplicates: true });

  // ── campaign ──
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CampaignMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<CampaignMatch | null>(null);
  const [memberStatus, setMemberStatus] = useState("");

  const [starting, setStarting] = useState(false);

  const onFile = useCallback((f: File) => {
    setFile(f);
    setParsed(null);
    f.text().then((text) => {
      const p = parseCsv(text);
      setParsed(p);
      setMapping(autoMapHeaders(p.headers));
    });
  }, []);

  // Debounced real campaign search (paste a Salesforce id or type a name).
  useEffect(() => {
    if (selected && query === selected.name) return;
    const q = query.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/campaigns/search?q=${encodeURIComponent(q)}`);
        const body = await res.json();
        setMatches(res.ok ? (body.matches ?? []) : []);
      } catch {
        setMatches([]);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query, selected]);

  const leads = useMemo(() => {
    if (!parsed) return [];
    return extractLeads(parsed.rows, parsed.lineNumbers, mapping);
  }, [parsed, mapping]);
  const flight = useMemo(() => preflight(leads, drops), [leads, drops]);

  const totalRows = parsed?.rows.length ?? 0;
  const overLimit = totalRows > MAX_ROWS;
  const eff = flight.clean.length;
  const dropped = totalRows - eff;
  const est = estimate(eff);

  const startReason = !parsed
    ? "Upload a CSV to start"
    : overLimit
      ? `Split the file to under ${fmtInt(MAX_ROWS)} rows first`
      : eff === 0
        ? "No runnable rows after pre-flight"
        : !selected
          ? "Pick a campaign first"
          : "";
  const startBlocked = Boolean(startReason);

  async function startRun() {
    if (startBlocked || !file || !parsed || !selected || starting) return;
    setStarting(true);
    try {
      // 1. Signed upload straight to Storage — never through a route handler.
      const tokenRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name }),
      });
      if (!tokenRes.ok) throw new Error("upload token");
      const { path, token } = await tokenRes.json();
      const supabase = createClient();
      const up = await supabase.storage.from("uploads").uploadToSignedUrl(path, token, file);
      if (up.error) throw new Error("upload");

      // 2. Create the run (server re-parses authoritatively).
      const createRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runName: file.name.replace(/\.csv$/i, "").replace(/[-_]+/g, " ") || "Event leads",
          fileName: file.name,
          storagePath: path,
          columnMapping: mapping,
          dropChoices: drops,
          campaign: {
            id: selected.id,
            name: selected.name,
            type: selected.type,
            status: selected.status,
            members: selected.members ?? null,
          },
          campaignMemberStatus: memberStatus,
        }),
      });
      const body = await createRes.json();
      if (!createRes.ok) throw new Error(body.error ?? "run creation failed");
      router.push(`/runs/${body.runId}`);
    } catch (cause) {
      toast(cause instanceof Error && cause.message !== "upload" ? `That didn't start: ${cause.message}` : "That didn't start — try again.", "error");
      setStarting(false);
    }
  }

  const preview = parsed ? parsed.rows.slice(0, 5) : [];
  const previewCols = parsed ? parsed.headers.slice(0, 6) : [];

  return (
    <main className="mx-auto max-w-[1020px] px-6 pb-[150px] pt-9">
      <div className="t-eyebrow-sm mb-[10px]">New run</div>
      <h1 className="t-display m-0 mb-[30px] text-[32px] leading-none tracking-[-0.025em]" style={{ fontWeight: 525 }}>
        Upload scans, pick a campaign, go
      </h1>

      {/* ── UPLOAD ── */}
      <Card className="mb-5 px-7 py-[26px]">
        <CardTitle title="Upload" hint={`CSV · up to ${fmtInt(MAX_ROWS)} rows`} className="mb-[18px]" />

        {!parsed && (
          <button
            type="button"
            aria-label="Upload a CSV — drop a file or click to browse"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
            className="flex w-full cursor-pointer flex-col items-center gap-[10px] rounded-[14px] border-[1.5px] border-dashed bg-oat-100 px-6 py-[52px] transition-colors duration-[120ms]"
            style={{ borderColor: dragOver ? "var(--tangerine-300)" : "var(--oat-300)", background: dragOver ? "var(--tangerine-hover-bg)" : undefined }}
          >
            <Image src="/brand/icons/List-Building.png" alt="" width={72} height={72} className="size-[72px] object-contain" />
            <span className="t-display text-[16px] font-medium text-oat-500">Drop your badge-scan CSV here</span>
            <span className="text-[13px] text-oat-400">or click to browse — parsing happens on your machine, instantly</span>
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Choose a CSV file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />

        {parsed && file && (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-[14px] rounded-md bg-oat-200 px-[18px] py-[14px]">
              <FileCsv aria-hidden="true" size={22} className="text-oat-500" />
              <span className="t-mono text-[13.5px] font-medium">{file.name}</span>
              <span className="t-mono text-[12px] text-oat-400">
                {fmtInt(totalRows)} rows · {parsed.delimiter === "\t" ? "tab" : parsed.delimiter === ";" ? "semicolon" : "comma"}-delimited · {Math.max(1, Math.round(file.size / 1024))} KB
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setParsed(null);
                  setMapping({});
                }}
                className="cursor-pointer border-0 bg-transparent px-2 py-1 font-body text-[12.5px] text-oat-400 hover:text-oat-500 hover:underline"
              >
                Remove
              </button>
            </div>

            {overLimit ? (
              <div className="flex items-start gap-[14px] rounded-md border border-lemon-200 bg-lemon-100 px-5 py-[18px]">
                <Scissors aria-hidden="true" size={20} className="mt-[1px] text-lemon-400" />
                <div>
                  <div className="mb-1 text-[14.5px] font-medium text-lemon-500">
                    This file is over the {fmtInt(MAX_ROWS)}-row limit for one run
                  </div>
                  <p className="m-0 text-[13.5px] leading-relaxed text-lemon-400" style={{ textWrap: "pretty" }}>
                    {fmtInt(totalRows)} rows won&rsquo;t fit in a single batch. Split the file in two and run them back
                    to back — both runs can write to the same campaign, and dedupe still works across them.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* preview */}
                <div className="t-mono-label mb-2">First 5 rows, as parsed</div>
                <div className="mb-6 overflow-x-auto rounded-md border border-hairline">
                  <table className="w-full min-w-[660px] border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        {previewCols.map((c) => (
                          <th
                            key={c}
                            className="t-mono whitespace-nowrap bg-oat-200 px-[14px] py-[9px] text-left text-[10.5px] font-semibold uppercase tracking-[.05em] text-oat-400"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr key={i} className="border-t border-line-soft">
                          {previewCols.map((c, j) => (
                            <td
                              key={c}
                              className={`t-mono whitespace-nowrap px-[14px] py-2 ${j === 0 ? "text-oat-500" : j === previewCols.length - 1 ? "text-oat-400" : ""}`}
                            >
                              {row[c] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* mapping */}
                <div className="mb-3 flex flex-wrap items-baseline gap-[10px]">
                  <div className="t-mono-label">Column mapping</div>
                  <span className="text-[12.5px] text-oat-400">
                    Auto-mapped from your headers — check the sample values. Each row needs one identity: an email, a
                    name + company, or a LinkedIn URL.
                  </span>
                </div>
                <div className="mb-[26px] grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3">
                  {FIELDS.map((field) => {
                    const col = mapping[field];
                    const sample = col && parsed.rows[0] ? (parsed.rows[0][col] ?? "") : "—";
                    return (
                      <div key={field} className="flex flex-col gap-2 rounded-md border border-hairline bg-oat-100 px-[14px] py-3">
                        <div className="flex items-center gap-[6px]">
                          <span className="t-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-oat-500">
                            {FIELD_LABELS[field]}
                          </span>
                          <span
                            className={`t-mono text-[10px] font-medium uppercase tracking-[.05em] ${IDENTITY_FIELDS.has(field) ? "text-tangerine-400" : "text-oat-400"}`}
                          >
                            {IDENTITY_FIELDS.has(field) ? "Identity" : "Optional"}
                          </span>
                        </div>
                        <Select
                          aria-label={`Source column for ${FIELD_LABELS[field]}`}
                          value={col ?? NOT_MAPPED}
                          onChange={(e) => {
                            const v = e.target.value;
                            setMapping((m) => ({ ...m, [field]: v === NOT_MAPPED ? undefined : v }));
                          }}
                        >
                          {[...parsed.headers, NOT_MAPPED].map((h) => (
                            <option key={h}>{h}</option>
                          ))}
                        </Select>
                        <div className="t-mono truncate text-[11.5px] text-oat-400">Row 1 · {sample || "—"}</div>
                      </div>
                    );
                  })}
                </div>

                {/* pre-flight */}
                <div className="t-mono-label mb-3">Before it costs you credits</div>
                <div className="mb-[14px] overflow-hidden rounded-md border border-hairline">
                  {(
                    [
                      {
                        id: "unidentified" as const,
                        count: flight.unidentified.length,
                        label: "Rows that can't be identified",
                        desc: "Each row needs an email, a name + company, or a LinkedIn URL. These have none of those.",
                      },
                      {
                        id: "malformed" as const,
                        count: flight.malformedEmail.length,
                        label: "Malformed emails",
                        desc: 'Things like "s.chen@rampcom" — cleaned here, before anything reaches Clay.',
                      },
                      {
                        id: "duplicates" as const,
                        count: flight.duplicates.length,
                        label: "Exact duplicates in this file",
                        desc: "Same person twice. Deduped here, before anything reaches Clay.",
                      },
                    ]
                  ).map((q, i) => (
                    <div
                      key={q.id}
                      className={`flex flex-wrap items-center gap-[14px] px-[18px] py-[14px] ${i > 0 ? "border-t border-line-soft" : ""}`}
                    >
                      <span className="t-mono tnum min-w-7 text-[16px] font-semibold text-lemon-400">{q.count}</span>
                      <div className="min-w-[200px] flex-1">
                        <div className="text-[14px] font-medium">{q.label}</div>
                        <div className="text-[12.5px] text-oat-400">{q.desc}</div>
                      </div>
                      <Segmented
                        ariaLabel={`${q.label}: drop or keep`}
                        options={[
                          { value: "drop", label: "Drop" },
                          { value: "keep", label: "Keep" },
                        ]}
                        value={drops[q.id] ? "drop" : "keep"}
                        onChange={(v) => setDrops((d) => ({ ...d, [q.id]: v === "drop" }))}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <span className="t-mono tnum text-[12.5px] font-medium text-oat-500">
                    Running {fmtInt(eff)} of {fmtInt(totalRows)} rows · {fmtInt(dropped)} dropped before upload
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </Card>

      {/* ── CAMPAIGN ── */}
      <Card className="mb-5 px-7 py-[26px]">
        <CardTitle title="Campaign" hint="Search a name or paste a Salesforce ID" className="mb-4" />
        <div className="max-w-[560px]">
          <CampaignCombobox
            query={query}
            onQueryChange={(q) => {
              setQuery(q);
              setSelected(null);
              setMemberStatus("");
            }}
            matches={matches}
            open={!selected && matches.length > 0}
            selected={selected}
            onSelect={(o) => {
              const match = o as CampaignMatch;
              setSelected(match);
              setQuery(match.name);
              const def = match.member_statuses?.find((s) => s.is_default)?.label ?? "";
              setMemberStatus(def || "");
            }}
          />
          {searching && !selected && (
            <div className="t-mono mt-2 text-[11.5px] text-oat-400">Searching Salesforce campaigns…</div>
          )}

          {selected && (
            <div className="rounded-[14px] border border-line bg-oat-100 px-[22px] py-5">
              <div className="flex flex-wrap items-start gap-[14px]">
                <div className="min-w-[220px] flex-1">
                  <div className="t-display mb-[6px] text-[17px] font-medium tracking-[-0.01em]">{selected.name}</div>
                  <div className="mb-3 flex flex-wrap gap-[6px]">
                    {selected.type && (
                      <StatusPill tone="oat" size="sm">
                        {selected.type}
                      </StatusPill>
                    )}
                    {selected.status && (
                      <StatusPill
                        tone={selected.is_active === false ? "oat" : "lime"}
                        size="sm"
                        fgOverride={selected.is_active === false ? "oat-400" : undefined}
                      >
                        {selected.status}
                      </StatusPill>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-[22px]">
                    <div>
                      <div className="t-mono-label mb-[3px] text-[10px]">Members today</div>
                      <div className="t-mono tnum text-[13px]">{selected.members == null ? "—" : fmtInt(selected.members)}</div>
                    </div>
                    <div>
                      <div className="t-mono-label mb-[3px] text-[10px]">Record</div>
                      {selected.url ? (
                        <a
                          href={selected.url}
                          target="_blank"
                          rel="noreferrer"
                          className="t-mono text-[13px] text-tangerine-400"
                        >
                          {truncateSfId(selected.id)}{" "}
                          <ArrowSquareOut aria-hidden="true" size={11} className="inline" />
                        </a>
                      ) : (
                        <span className="t-mono text-[13px]">{truncateSfId(selected.id)}</span>
                      )}
                    </div>
                    <div>
                      <div className="t-mono-label mb-[3px] text-[10px]">Member status</div>
                      <Select
                        aria-label="Campaign member status for this run"
                        value={memberStatus}
                        onChange={(e) => setMemberStatus(e.target.value)}
                        className="min-w-[160px]"
                      >
                        <option value="">Campaign default</option>
                        {(selected.member_statuses ?? [])
                          .filter((s) => s.label)
                          .map((s) => (
                            <option key={s.label!} value={s.label!}>
                              {s.label}
                            </option>
                          ))}
                      </Select>
                    </div>
                  </div>
                </div>
                <CheckCircle aria-hidden="true" size={22} className="text-lime-400" />
              </div>
              <p className="mb-0 mt-[14px] border-t border-line-soft pt-3 text-[12.5px] text-oat-400" style={{ textWrap: "pretty" }}>
                This is where {fmtInt(eff)} people will land. Validated against Salesforce just now — if it&rsquo;s the
                wrong campaign, now&rsquo;s the moment.
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* ── REVIEW & RUN — sticky ── */}
      <div className="sticky bottom-[14px] z-30">
        <section
          aria-label="Review and run"
          className="flex flex-wrap items-center gap-[18px] rounded-lg border border-line bg-white px-[22px] py-4 shadow-md"
        >
          <div className="flex flex-wrap items-center gap-[10px]">
            <span className="t-mono tnum text-[14px] font-semibold">
              {parsed ? `${fmtInt(overLimit ? totalRows : eff)} rows` : "No file yet"}
            </span>
            <ArrowRight aria-hidden="true" size={14} className="text-oat-400" />
            <span className="text-[14px] font-medium">{selected?.name ?? "Pick a campaign"}</span>
          </div>
          <div className="flex-1" />
          {parsed && !overLimit && eff > 0 && (
            <span className="t-mono tnum text-[12px] text-oat-400">
              ≈{fmtInt(est.credits)} credits · ≈{est.minutes} min
            </span>
          )}
          <Button
            variant="primary"
            size="lg"
            disabled={startBlocked || starting}
            disabledReason={startBlocked ? startReason : undefined}
            onClick={startRun}
            iconRight={<ArrowRight size={15} weight="bold" />}
          >
            {starting ? "Starting…" : "Start run"}
          </Button>
        </section>
      </div>
    </main>
  );
}
