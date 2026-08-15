"use client";

import { useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  ArrowCounterClockwise,
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  CheckCircle,
  DownloadSimple,
  HourglassMedium,
  MagnifyingGlass,
  Plus,
  TrafficCone,
} from "@phosphor-icons/react";
import { Banner } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { CampaignCombobox, type CampaignOption } from "@/components/ui/combobox";
import { Card, CardTitle } from "@/components/ui/card";
import { ChunkTrack, type ChunkCell } from "@/components/ui/chunk-track";
import { DemoPill } from "@/components/ui/demo-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ProgressDisplay } from "@/components/ui/progress-display";
import { RunStatusPill, StatusPill, type RunStatusKey } from "@/components/ui/status-pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableScroll, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { fmtInt, truncateSfId } from "@/lib/ui/format";

/* ── demo data lifted from the approved prototype ── */

const CAMPAIGNS: CampaignOption[] = [
  { id: "701Kd00000rTHcQAJ", name: "SXSW 2026 — Booth Leads", type: "Conference", status: "Active", members: 1204 },
  { id: "701Kd00000rR2wAB0", name: "SXSW 2026 — Party RSVPs", type: "Event", status: "Active", members: 312 },
  { id: "701Hs00000a9kQAT0", name: "SXSW 2025 — Booth Leads", type: "Conference", status: "Completed", members: 2847 },
  { id: "701Hs00000aM4nAF0", name: "SXSW 2025 — Speaker Dinner", type: "Event", status: "Completed", members: 48 },
];

const RESULT_ROWS = [
  { name: "Sarah Chen", email: "s.chen@ramp.com", phone: "+1 (512) 555-0107", st: "written", reason: "" },
  { name: "Marcus Okafor", email: "m.okafor@notion.so", phone: "+1 (512) 555-0144", st: "failed", reason: "Bad email" },
  { name: "Priya Sharma", email: "p.sharma@figma.com", phone: "—", st: "written", reason: "" },
  { name: "Diego Ramirez", email: "d.ramirez@loom.com", phone: "+1 (512) 555-0118", st: "skipped", reason: "Already in campaign" },
  { name: "Hannah Kowalski", email: "h.kowalski@airtable.com", phone: "+1 (512) 555-0155", st: "written", reason: "" },
  { name: "Tobias Berg", email: "t.berg@retool.com", phone: "+1 (512) 555-0192", st: "failed", reason: "No enrichment match" },
] as const;

const RUN_STATUSES: RunStatusKey[] = [
  "queued",
  "uploading",
  "validating",
  "running",
  "finalizing",
  "stalled",
  "completed_with_failures",
  "complete",
  "validation_failed",
];

function makeChunks(total: number, done: number, runningFinished?: number): ChunkCell[] {
  return Array.from({ length: total }, (_, i) => {
    const size = 100;
    if (i < done) return { index: i + 1, state: "done" as const, finished: size, size };
    if (i === done && runningFinished !== undefined)
      return { index: i + 1, state: "running" as const, finished: runningFinished, size };
    return { index: i + 1, state: "queued" as const, finished: 0, size };
  });
}

/* ── layout scaffolding for the gallery itself ── */

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="mb-12">
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h2 className="t-display m-0 text-[22px] font-medium tracking-[-0.02em]">{title}</h2>
        {note && <span className="text-[13px] text-oat-400">{note}</span>}
      </div>
      <div className="mb-4 h-px bg-hairline" />
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="t-mono-label mb-[9px]">{label}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const SWATCH_FAMILIES: Array<{ name: string; vars: string[] }> = [
  { name: "Oat", vars: ["--oat-100", "--oat-200", "--oat-300", "--oat-400", "--oat-500"] },
  { name: "Tangerine", vars: ["--tangerine-100", "--tangerine-200", "--tangerine-300", "--tangerine-400", "--tangerine-500"] },
  { name: "Lime", vars: ["--lime-100", "--lime-200", "--lime-300", "--lime-400", "--lime-500"] },
  { name: "Lemon", vars: ["--lemon-100", "--lemon-200", "--lemon-300", "--lemon-400", "--lemon-500"] },
  { name: "Pomegranate", vars: ["--pom-100", "--pom-200", "--pom-300", "--pom-400", "--pom-500"] },
  { name: "Blueberry", vars: ["--blueberry-100", "--blueberry-200", "--blueberry-300", "--blueberry-400", "--blueberry-500"] },
  { name: "Slushie", vars: ["--slushie-100", "--slushie-200", "--slushie-300", "--slushie-400", "--slushie-500"] },
  { name: "Dragonfruit", vars: ["--dragon-100", "--dragon-200", "--dragon-300", "--dragon-400", "--dragon-500"] },
  { name: "Ube", vars: ["--ube-100", "--ube-200", "--ube-300", "--ube-400", "--ube-500"] },
];

export function Gallery() {
  const { toast } = useToast();

  // combobox demo state
  const [query, setQuery] = useState("sxsw");
  const [selected, setSelected] = useState<CampaignOption | null>(null);
  const matches = useMemo(
    () => CAMPAIGNS.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())),
    [query],
  );
  const comboOpen = query.trim().length > 0 && !selected && matches.length > 0;

  // segmented demo state
  const [dropKeep, setDropKeep] = useState<Record<string, "drop" | "keep">>({
    missing: "drop",
    malformed: "drop",
    dupes: "keep",
  });

  // stat tile count-up demo
  const [statSeed, setStatSeed] = useState(0);
  const stats = useMemo(() => {
    const total = 389;
    const succ = [223, 371, 148, 302][statSeed % 4];
    const fail = [9, 18, 3, 0][statSeed % 4];
    const skip = [5, 0, 12, 7][statSeed % 4];
    return { total, succ, fail, skip };
  }, [statSeed]);

  return (
    <main className="mx-auto max-w-[1020px] px-6 pb-[130px] pt-9">
      <div className="t-eyebrow-sm mb-[10px]">Phase 1 · dev only</div>
      <h1 className="t-display m-0 mb-2 text-[32px] leading-none tracking-[-0.025em]" style={{ fontWeight: 525 }}>
        Component gallery
      </h1>
      <p className="mb-10 mt-0 max-w-[640px] text-[14.5px] text-oat-400" style={{ textWrap: "pretty" }}>
        Every primitive from the approved prototype, in every state. Compare side by side with{" "}
        <span className="t-mono text-[13px]">design/prototype/Event Lead Router.dc.html</span> — presentation
        differences are bugs.
      </p>

      {/* ── TOKENS ─────────────────────────────────────────── */}
      <Section id="tokens" title="Tokens" note="colors, type, radii, shadows — all from app/globals.css">
        <div className="mb-6 grid gap-[6px]">
          {SWATCH_FAMILIES.map((fam) => (
            <div key={fam.name} className="flex items-center gap-[6px]">
              <span className="t-mono-label w-[92px] shrink-0">{fam.name}</span>
              {fam.vars.map((v) => (
                <div
                  key={v}
                  title={v}
                  className="h-9 flex-1 rounded-sm border border-hairline"
                  style={{ background: `var(${v})` }}
                />
              ))}
            </div>
          ))}
        </div>
        <Row label="Type — display (Roobert, ss01/ss10/ss11)">
          <div className="flex flex-col gap-2">
            <span className="t-display text-[40px] leading-[1.02] tracking-[-0.03em]" style={{ fontWeight: 525 }}>
              Upload scans, pick a campaign, go
            </span>
            <span className="t-display text-[18px] font-medium tracking-[-0.015em]">Section heading eighteen</span>
            <span className="text-[14px]">Body fourteen — the quick brown fox asks a question?</span>
            <span className="t-mono tnum text-[13px] font-medium">MONO 13 · 1,204 rows · 95.4%</span>
            <span className="t-eyebrow-sm">Eyebrow label twelve</span>
          </div>
        </Row>
        <Row label="Radii & shadows">
          {(["xs", "sm", "md", "lg"] as const).map((s) => (
            <div
              key={s}
              className="flex h-20 w-28 items-center justify-center rounded-lg border border-hairline bg-white"
              style={{ boxShadow: `var(--shadow-${s})` }}
            >
              <span className="t-mono-label">shadow-{s}</span>
            </div>
          ))}
        </Row>
      </Section>

      {/* ── BUTTONS ────────────────────────────────────────── */}
      <Section id="buttons" title="Button" note="pill always; hover darkens or fills; disabled = 40% + reason">
        <Row label="Variants">
          <Button variant="primary" size="lg" iconRight={<ArrowRight size={15} weight="bold" />}>
            Start run
          </Button>
          <Button variant="dark" iconLeft={<Plus size={14} />}>
            New run
          </Button>
          <Button variant="secondary" iconLeft={<DownloadSimple size={15} />}>
            Export results CSV
          </Button>
          <Button variant="ghost">Run history</Button>
        </Row>
        <Row label="Sizes">
          <Button variant="secondary" size="sm">
            Failures only
          </Button>
          <Button variant="secondary" size="md" iconLeft={<ArrowsClockwise size={14} />}>
            Refresh
          </Button>
          <Button variant="primary" size="lg" iconLeft={<ArrowCounterClockwise size={15} weight="bold" />}>
            Retry 18 failed rows
          </Button>
        </Row>
        <Row label="Disabled, with reason (the design never disables silently)">
          <Button variant="primary" size="lg" disabled disabledReason="Upload a CSV to start">
            Start run
          </Button>
        </Row>
        <Row label="Disabled, over-limit reason">
          <Button variant="primary" size="lg" disabled disabledReason="Split the file to under 50,000 rows first">
            Start run
          </Button>
        </Row>
      </Section>

      {/* ── PILLS ──────────────────────────────────────────── */}
      <Section id="pills" title="StatusPill" note="every pill pairing in the design">
        <Row label="Run status (md, with activity dot)">
          {RUN_STATUSES.map((s) => (
            <RunStatusPill key={s} status={s} />
          ))}
        </Row>
        <Row label="Row status (xs)">
          <StatusPill tone="lime" size="xs" fgOverride="lime-450">Written</StatusPill>
          <StatusPill tone="pom" size="xs">Failed</StatusPill>
          <StatusPill tone="lemon" size="xs" fgOverride="lemon-400">Skipped</StatusPill>
        </Row>
        <Row label="Chips (sm)">
          <StatusPill tone="oat" size="sm">Conference</StatusPill>
          <StatusPill tone="lime" size="sm">Active</StatusPill>
          <StatusPill tone="oat" size="sm" fgOverride="oat-400">Completed</StatusPill>
          <StatusPill tone="lime" size="sm">Found</StatusPill>
        </Row>
        <Row label="Failure-cause pill (monitor roll-up)">
          <span className="t-mono inline-flex items-center gap-[7px] rounded-pill bg-pom-100 px-3 py-[7px] text-[12px] font-medium text-pom-400">
            <span className="tnum font-semibold">11</span>Bad email
          </span>
          <span className="t-mono inline-flex items-center gap-[7px] rounded-pill bg-pom-100 px-3 py-[7px] text-[12px] font-medium text-pom-400">
            <span className="tnum font-semibold">5</span>No enrichment match
          </span>
          <span className="t-mono inline-flex items-center gap-[7px] rounded-pill bg-pom-100 px-3 py-[7px] text-[12px] font-medium text-pom-400">
            <span className="tnum font-semibold">2</span>Salesforce write rejected
          </span>
        </Row>
        <Row label="Demo pill (required, every signed-in screen)">
          <DemoPill />
        </Row>
      </Section>

      {/* ── INPUTS ─────────────────────────────────────────── */}
      <Section id="inputs" title="Input · Select · Segmented">
        <div className="mb-5 grid max-w-[560px] gap-3">
          <div className="t-mono-label">Search input, empty</div>
          <Input
            icon={<MagnifyingGlass size={16} />}
            placeholder="Campaign name or Salesforce ID"
            aria-label="Campaign name or Salesforce ID (empty example)"
          />
          <div className="t-mono-label mt-2">Resolved, with Found pill</div>
          <Input
            defaultValue="SXSW 2026 — Booth Leads"
            aria-label="Campaign name or Salesforce ID (resolved example)"
            trailing={<StatusPill tone="lime" size="sm">Found</StatusPill>}
          />
        </div>
        <Row label="Select (column mapping)">
          <div className="grid w-full max-w-[270px] gap-2 rounded-md border border-hairline bg-oat-100 p-[14px]">
            <div className="flex items-center gap-[6px]">
              <span className="t-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-oat-500">Email</span>
              <span className="t-mono text-[10px] font-medium uppercase tracking-[.05em] text-tangerine-400">Identity</span>
            </div>
            <Select aria-label="Source column for Email" defaultValue="email_address">
              {["first_name", "last_name", "email_address", "company", "job_title", "linkedin", "Not mapped"].map(
                (o) => (
                  <option key={o}>{o}</option>
                ),
              )}
            </Select>
            <div className="t-mono truncate text-[11.5px] text-oat-400">Row 1 · s.chen@ramp.com</div>
          </div>
          <div className="grid w-full max-w-[270px] gap-2 rounded-md border border-hairline bg-oat-100 p-[14px]">
            <div className="flex items-center gap-[6px]">
              <span className="t-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-oat-500">Phone</span>
              <span className="t-mono text-[10px] font-medium uppercase tracking-[.05em] text-oat-400">Optional</span>
            </div>
            <Select aria-label="Source column for Phone" defaultValue="Not mapped">
              {["first_name", "last_name", "email_address", "company", "job_title", "linkedin", "Not mapped"].map(
                (o) => (
                  <option key={o}>{o}</option>
                ),
              )}
            </Select>
            <div className="t-mono truncate text-[11.5px] text-oat-400">Row 1 · —</div>
          </div>
        </Row>
        <Row label="Segmented Drop / Keep (pre-flight)">
          {(
            [
              { id: "missing", count: 12, label: "Rows that can't be identified" },
              { id: "malformed", count: 3, label: "Malformed emails" },
              { id: "dupes", count: 8, label: "Exact duplicates in this file" },
            ] as const
          ).map((q) => (
            <div key={q.id} className="flex w-full max-w-[560px] items-center gap-[14px] rounded-md border border-hairline px-[18px] py-[14px]">
              <span className="t-mono tnum min-w-7 text-[16px] font-semibold text-lemon-400">{q.count}</span>
              <span className="flex-1 text-[14px] font-medium">{q.label}</span>
              <Segmented
                ariaLabel={`${q.label}: drop or keep`}
                options={[
                  { value: "drop", label: "Drop" },
                  { value: "keep", label: "Keep" },
                ]}
                value={dropKeep[q.id]}
                onChange={(v) => setDropKeep((s) => ({ ...s, [q.id]: v }))}
              />
            </div>
          ))}
        </Row>
      </Section>

      {/* ── COMBOBOX ───────────────────────────────────────── */}
      <Section
        id="combobox"
        title="Combobox"
        note='live: type to filter, arrows + Enter to pick, Escape clears — try "sxsw"'
      >
        <div className="max-w-[560px]">
          <CampaignCombobox
            query={query}
            onQueryChange={(q) => {
              setQuery(q);
              setSelected(null);
            }}
            matches={matches}
            open={comboOpen}
            selected={selected}
            onSelect={(o) => {
              setSelected(o);
              setQuery(o.name);
              toast(`Campaign selected: ${o.name}`, "success");
            }}
          />
          {selected && (
            <div className="mt-[14px] rounded-[14px] border border-line bg-oat-100 px-[22px] py-5">
              <div className="flex flex-wrap items-start gap-[14px]">
                <div className="min-w-[220px] flex-1">
                  <div className="t-display mb-[6px] text-[17px] font-medium tracking-[-0.01em]">{selected.name}</div>
                  <div className="mb-3 flex flex-wrap gap-[6px]">
                    <StatusPill tone="oat" size="sm">{selected.type}</StatusPill>
                    <StatusPill
                      tone={selected.status === "Active" ? "lime" : "oat"}
                      size="sm"
                      fgOverride={selected.status === "Active" ? undefined : "oat-400"}
                    >
                      {selected.status}
                    </StatusPill>
                  </div>
                  <div className="flex flex-wrap gap-[22px]">
                    <div>
                      <div className="t-mono-label mb-[3px] text-[10px]">Members today</div>
                      <div className="t-mono tnum text-[13px]">{fmtInt(selected.members)}</div>
                    </div>
                    <div>
                      <div className="t-mono-label mb-[3px] text-[10px]">Record</div>
                      <a href="#sf" className="t-mono text-[13px] text-tangerine-400">
                        {truncateSfId(selected.id)} <ArrowSquareOut aria-hidden="true" size={11} className="inline" />
                      </a>
                    </div>
                  </div>
                </div>
                <CheckCircle aria-hidden="true" size={22} className="text-lime-400" />
              </div>
              <p className="mb-0 mt-[14px] border-t border-line-soft pt-3 text-[12.5px] text-oat-400" style={{ textWrap: "pretty" }}>
                This is where 389 people will land. Validated against Salesforce just now — if it&rsquo;s the wrong
                campaign, now&rsquo;s the moment.
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* ── CARD ───────────────────────────────────────────── */}
      <Section id="cards" title="Card">
        <Card className="mb-4 px-7 py-[26px]">
          <CardTitle title="Upload" hint="CSV · up to 50,000 rows" className="mb-2" />
          <p className="m-0 text-[13.5px] text-oat-400">Section card — radius 16, 1px #E6E8EC, white on cream.</p>
        </Card>
        <Card radius={20} className="px-8 py-[30px]">
          <CardTitle title="Progress" hint="radius 20 variant" />
        </Card>
      </Section>

      {/* ── TABLE ──────────────────────────────────────────── */}
      <Section
        id="table"
        title="Table"
        note="sticky header + sticky first column — scroll inside the card, both axes"
      >
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-[10px] px-5 pb-3 pt-4">
            <h3 className="t-display m-0 text-[16px] font-medium tracking-[-0.01em]">Results</h3>
            <span className="t-mono tnum text-[11.5px] text-oat-400">6 rows in</span>
          </div>
          <TableScroll maxHeight={300}>
            <Table minWidth={760}>
              <thead>
                <tr>
                  <Th stickyLeft className="px-5">Name</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Status</Th>
                  <Th className="pl-[14px] pr-5">Salesforce</Th>
                </tr>
              </thead>
              <tbody>
                {RESULT_ROWS.map((r, i) => (
                  <tr key={r.name} style={{ animation: `rowIn .5s cubic-bezier(.2,0,0,1) both ${i * 14}ms` }}>
                    <Td stickyLeft className="px-5 font-medium">{r.name}</Td>
                    <Td className="t-mono text-[12px] text-oat-400">{r.email}</Td>
                    <Td className="t-mono tnum text-[12px] text-oat-400">{r.phone}</Td>
                    <Td>
                      {r.st === "written" && <StatusPill tone="lime" size="xs" fgOverride="lime-450">Written</StatusPill>}
                      {r.st === "failed" && <StatusPill tone="pom" size="xs">Failed</StatusPill>}
                      {r.st === "skipped" && <StatusPill tone="lemon" size="xs" fgOverride="lemon-400">Skipped</StatusPill>}
                      {r.reason && <span className="ml-2 text-[12px] text-oat-400">{r.reason}</span>}
                    </Td>
                    <Td className="pl-[14px] pr-5">
                      {r.st === "written" ? (
                        <a href="#sf" className="t-mono text-[12px] text-tangerine-400">
                          View <ArrowSquareOut aria-hidden="true" size={11} className="inline" />
                        </a>
                      ) : (
                        <span className="text-oat-300">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        </Card>
      </Section>

      {/* ── STAT TILES ─────────────────────────────────────── */}
      <Section id="stat-tiles" title="StatTile" note="tabular figures; values count up with the house easing">
        <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <StatTile label="Total" value={stats.total} />
          <StatTile label="Succeeded" value={stats.succ} />
          <StatTile label="Failed" value={stats.fail} danger={stats.fail > 0} />
          <StatTile label="Skipped" value={stats.skip} />
          <StatTile label="Success rate" value={stats.succ === 0 ? "—" : `${((stats.succ / stats.total) * 100).toFixed(1)}%`} />
        </div>
        <Button variant="secondary" size="sm" onClick={() => setStatSeed((s) => s + 1)}>
          Randomize values
        </Button>
      </Section>

      {/* ── PROGRESS ───────────────────────────────────────── */}
      <Section
        id="progress"
        title="ProgressDisplay"
        note="rate and ETA render only when honest — the empty right side is deliberate"
      >
        <Card radius={20} className="mb-4 px-8 pb-[26px] pt-[30px]">
          <ProgressDisplay
            percent={47}
            processedText="183 of 389 rows"
            phaseHint="Enriching in chunks of 100 — rows land below as each completes."
            rateText="1,240"
            etaText="≈ 2 min"
          />
        </Card>
        <Card radius={20} className="px-8 pb-[26px] pt-[30px]">
          <ProgressDisplay
            percent={3}
            processedText="12 of 389 rows"
            phaseHint="Enriching in chunks of 100 — rows land below as each completes."
          />
        </Card>
      </Section>

      {/* ── CHUNK TRACK ────────────────────────────────────── */}
      <Section id="chunk-track" title="ChunkTrack" note="4 → 53 → 500 chunks; hover any cell for its tooltip">
        <div className="grid gap-7">
          <ChunkTrack
            chunks={[
              { index: 1, state: "done", finished: 100, size: 100 },
              { index: 2, state: "failed", finished: 61, size: 100 },
              { index: 3, state: "running", finished: 47, size: 100 },
              { index: 4, state: "queued", finished: 0, size: 89 },
            ]}
          />
          <ChunkTrack chunks={makeChunks(53, 29, 47)} />
          <ChunkTrack chunks={makeChunks(500, 213, 62)} />
          <div>
            <div className="t-mono-label mb-2">Paused (stalled / rate-limited): pulse freezes, tooltip says stuck</div>
            <ChunkTrack
              paused
              chunks={[
                { index: 1, state: "done", finished: 100, size: 100 },
                { index: 2, state: "done", finished: 100, size: 100 },
                { index: 3, state: "running", finished: 47, size: 100 },
                { index: 4, state: "queued", finished: 0, size: 89 },
              ]}
            />
          </div>
        </div>
      </Section>

      {/* ── SKELETON ───────────────────────────────────────── */}
      <Section id="skeleton" title="Skeleton" note="static bars — the brand is calm, no shimmer">
        <div className="max-w-[520px]">
          <SkeletonRows note="Rows land here in batches as each chunk completes — the first batch is on its way." />
          <div className="mt-4 flex gap-3">
            <Skeleton width={120} height={32} />
            <Skeleton width={220} height={32} />
          </div>
        </div>
      </Section>

      {/* ── EMPTY STATE ────────────────────────────────────── */}
      <Section id="empty-state" title="EmptyState" note="every empty state has an action">
        <EmptyState
          icon="/brand/icons/Update-CRM.png"
          title="No runs yet"
          body="Upload a badge-scan CSV and Event Lead Router enriches every person and writes them into a Salesforce campaign — with receipts."
          action={
            <Button variant="primary" size="lg" iconRight={<ArrowRight size={15} weight="bold" />}>
              Start your first run
            </Button>
          }
        />
      </Section>

      {/* ── BANNERS ────────────────────────────────────────── */}
      <Section id="banners" title="Banner / ErrorState" note="plain-language cause + recovery path; never color alone">
        <div className="grid gap-3">
          <Banner
            tone="warning"
            icon={<HourglassMedium size={20} />}
            title="Nothing has moved for 4 minutes"
            body="Chunk 3 has been stuck at 47 of 100 rows. Retrying won't touch the rows already written."
            action={
              <Button variant="dark" onClick={() => toast("Retrying stuck chunks", "info")}>
                Retry stuck chunks
              </Button>
            }
          />
          <Banner
            tone="info"
            icon={<TrafficCone size={20} />}
            title="Clay asked us to slow down"
            body="Rate limited — the run pauses and resumes on its own. Nothing is lost."
            action={<span className="t-mono tnum text-[12px] font-semibold text-blueberry-500">Resuming in 42s</span>}
          />
          <Banner
            tone="neutral"
            icon={
              <span
                aria-hidden="true"
                className="block size-2 rounded-full bg-pom-300"
                style={{ animation: "dotBlink 1.2s infinite" }}
              />
            }
            title="Connection lost — retrying"
            body="The numbers below are from 38s ago. The run itself keeps going on Clay's side."
            action={<Button variant="secondary">Try now</Button>}
          />
          <Banner
            tone="danger"
            icon={<TrafficCone size={20} />}
            title="Clay rejected this file before the run started"
            body="340 rows didn't validate, so nothing ran and no credits were spent."
            role="alert"
          />
        </div>
      </Section>

      {/* ── TOAST ──────────────────────────────────────────── */}
      <Section id="toast" title="Toast" note="ink, bottom-center, auto-dismisses in 5s">
        <Row label="Fire one">
          <Button variant="secondary" onClick={() => toast("Export started — the CSV is on its way.", "success")}>
            Success
          </Button>
          <Button variant="secondary" onClick={() => toast("Copied the run link.", "info")}>
            Info
          </Button>
          <Button variant="secondary" onClick={() => toast("That didn't save — try again.", "error")}>
            Error
          </Button>
        </Row>
      </Section>

      {/* ── BRAND ASSETS ───────────────────────────────────── */}
      <Section id="assets" title="Brand assets" note="claymation icons ship as-is: never tinted, never circle-masked">
        <Row label="Logos">
          <div className="flex items-center gap-8 rounded-lg border border-hairline bg-white px-6 py-5">
            <Image src="/brand/Clay_Logo_3D_Blk.png" alt="Clay wordmark" width={126} height={44} className="h-11 w-auto object-contain" />
            <Image src="/brand/Clay_Arch_3D.png" alt="Clay arch icon" width={44} height={44} className="size-11 object-contain" />
          </div>
        </Row>
        <Row label="Claymation icons (512px source, shown at use sizes)">
          <div className="flex items-end gap-8 rounded-lg border border-hairline bg-white px-6 py-5">
            <figure className="m-0 text-center">
              <Image src="/brand/icons/List-Building.png" alt="" width={72} height={72} className="size-[72px] object-contain" />
              <figcaption className="t-mono-label mt-2 text-[9.5px]">List-Building · 72</figcaption>
            </figure>
            <figure className="m-0 text-center">
              <Image src="/brand/icons/Check-A.png" alt="" width={84} height={84} className="size-[84px] object-contain" />
              <figcaption className="t-mono-label mt-2 text-[9.5px]">Check-A · 84</figcaption>
            </figure>
            <figure className="m-0 text-center">
              <Image src="/brand/icons/Update-CRM.png" alt="" width={110} height={110} className="size-[110px] object-contain" />
              <figcaption className="t-mono-label mt-2 text-[9.5px]">Update-CRM · 110</figcaption>
            </figure>
          </div>
        </Row>
      </Section>
    </main>
  );
}
