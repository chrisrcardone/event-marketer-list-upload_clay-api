# Design contract — extracted from the approved prototype

Source of truth: `design/prototype/Event Lead Router.dc.html` (approved via two review rounds).
This file is the distilled, implementable spec. Where this file and the prototype HTML disagree,
the prototype wins on presentation. Where behavior differs from `docs/technical-spec.md` or the
build prompt, behavior rules win.

## Global

- Page background `#FEFDFB` (oat-100), ink `#1B1A18` (oat-500). Cream, never white, for the page.
- White `#FFFFFF` is reserved for cards/inputs sitting on the cream.
- Body font: Roobert (`--font-body`); UI labels/stats/eyebrows: Roobert SemiMono (`--font-mono`,
  always with `font-variation-settings: "MONO" 0.5`); headings: Roobert display weights 500–575.
- Focus ring everywhere: `outline: 2px solid #FF7714; outline-offset: 2px; border-radius: 4px` on
  `:focus-visible` only.
- Selection: `::selection { background: #FCC9AB }`.
- Keyframes: `rowIn` (fade + translateY(5px)→0, .5s), `chunkPulse` (opacity 1→.5→1, 1.5s),
  `dotBlink` (opacity 1→.25→1). House easing `cubic-bezier(.2, 0, 0, 1)` on all of them.
- Numbers that update are always `font-variant-numeric: tabular-nums`.
- No gradients, no colored glows, no emoji, sentence case everywhere (Terra hard rules).

## Top bar (all signed-in screens)

Sticky, 60px, z-40, `rgba(254,253,251,.86)` + `backdrop-filter: blur(12px)`, bottom border
`1px #EDEBE8`, horizontal padding 24px, gap 20px.

- Left: `Clay_Arch_3D.png` 24×24 → "Event Lead Router" (display 500, 16px, −0.01em) → **Demo pill**
  (mono 600, 9.5px, +.06em, uppercase, padding 4px 9px 3px, pill radius, bg `#F4F3F0`,
  color `#7B7974`, border `1px #E6E8EC`). The Demo pill is required on every signed-in screen.
- Nav (gap 4, ml 8): "Run history", "New run" — ghost pills, display 500, 13.5px, padding 7px 14px;
  active page bg `#F4F3F0`; hover bg `#F4F3F0`.
- Right: primary "New run" black pill (bg `#1B1A18`, fg `#FEFDFB`, 13.5px, padding 9px 18px,
  `ph-plus` icon, hover opacity .9) then avatar: 32×32, radius 10px, bg `#F4F3F0`,
  border `#EDEBE8`, initials mono 600 11px `#7B7974`, `title` = email,
  `aria-label` = "Signed in as {name}".

## Screen: Sign in (no top bar)

Centered column, max-w 420, text-center.
- `Clay_Logo_3D_Blk.png` height 44, margin-bottom 36.
- Eyebrow "Internal tool" (t-eyebrow-sm), mb 14.
- H1 "Event Lead Router" — display 525, 40px, lh 1.02, −0.03em, mb 14.
- Sub (16px, lh 1.5, `#7B7974`, max-w 320, mb 36): "Badge scans in. Enriched, deduped leads in
  your Salesforce campaign — with a number you can stand behind."
- Google button: white bg, border `1px #D1CDC7`, pill, padding 13px 26px, display 500 15.5px,
  18px Google "G" SVG, label "Continue with Google", hover bg `#F4F3F0`.
- "clay.com accounts only" — mono 500 11px +.06em uppercase `#7B7974`, mt 22. (Copy uses the
  configured domain(s).)
- **Required disclaimer** (12.5px `#7B7974`, mt 14, max-w 320): "This is a demo built to show what
  a Clay-powered workflow can do — not an official Clay internal tool."

## Screen: Rejected domain (no top bar)

Centered, max-w 440. Logo h 44 mb 36. Card: white, border `#EDEBE8`, radius 20, padding 40px 36px.
- Icon tile 44×44, radius 14, bg `#F4F3F0`, `ph-hand-palm` 22px `#7B7974`, mb 20.
- H1 "That account won't work here" — display 525, 26px, −0.02em, mb 12.
- Body 14.5px `#7B7974`: "You signed in as **{email}**. Event Lead Router is limited to
  **@{domain}** Google accounts." Then: "Nothing's broken — it's just the guest list." (mb 26)
- Black pill "Use a different account" (14.5px, padding 11px 22px) → signs out, back to sign-in.
- Below card, 12.5px `#7B7974`: "Think you should have access? Ask in #gtm-engineering."
This is a policy outcome, not an error: no red, no stack traces.

## Screen: New run (max-w 1020, padding 36 24 150)

Eyebrow "New run" mb 10 → H1 "Upload scans, pick a campaign, go" (display 525, 32px, −0.025em) mb 30.

### Upload card (white, border `#E6E8EC`, radius 16, padding 26px 28px, mb 20)
- Header: h2 "Upload" (display 500 18px −0.015em) + mono hint "CSV · up to 50,000 rows".
- **Empty**: full-width dropzone `<button>`: 1.5px dashed `#D1CDC7`, bg `#FEFDFB`, radius 14,
  padding 52px 24px; hover/dragover: border `#FF7714`, bg `#FFF9F5`. `List-Building.png` 72×72,
  "Drop your badge-scan CSV here" (display 500 16px), "or click to browse — parsing happens on
  your machine, instantly" (13px `#7B7974`). aria-label "Upload a CSV — drop a file or click to browse".
- **Loaded**: file bar bg `#F4F3F0` radius 12 padding 14px 18px: `ph-file-csv` 22px, filename
  (mono 500 13.5px), meta (mono 12px `#7B7974`, e.g. "412 rows · comma-delimited · 48 KB"),
  ghost "Remove" right.
- **Over-limit (50k) variant**: lemon notice — border `#FBE189`, bg `#FEFAE8`, radius 12, padding
  18px 20px, `ph-scissors` 20px `#9E5802`. Title 14.5px 500 `#372201`: "This file is over the
  50,000-row limit for one run". Body 13.5px `#9E5802`: "{n} rows won't fit in a single batch.
  Split the file in two and run them back to back — both runs can write to the same campaign, and
  dedupe still works across them." No mapping/preview shown; Start blocked with reason
  "Split the file to under 50,000 rows first".
- **Preview** ("First 5 rows, as parsed", mono label): bordered table radius 12, overflow-x auto,
  min-w 660, 12.5px; th bg `#F4F3F0` mono 600 10.5px uppercase `#7B7974` padding 9px 14px; td mono
  padding 8px 14px, row separators `1px #EFF1F3`; first data col ink, last col `#7B7974`.
- **Column mapping**: label + helper "Auto-mapped from your headers — check the sample values.
  Each row needs one identity: an email, a name + company, or a LinkedIn URL."
  Grid `repeat(auto-fill, minmax(270px, 1fr))` gap 12, mb 26. Card: border `#EDEBE8` radius 12
  padding 12px 14px bg `#FEFDFB`; field name mono 600 10.5px uppercase; tag mono 500 10px uppercase
  — **Identity** in `#B53D0A`, **Optional** in `#7B7974`; select: border `#E6E8EC` radius 9,
  padding 8px 10px, 13px, options = uploaded file's headers + "Not mapped"; sample line
  "Row 1 · {value}" mono 11.5px `#7B7974`, single-line ellipsis.
  Fields: First name (Identity), Last name (Identity), Email (Identity), Company (Identity),
  Title (Optional), Phone (Optional), LinkedIn URL (Identity). **Email is never "Required".**
- **Pre-flight** ("Before it costs you credits"): bordered list radius 12; each row: count mono 600
  16px `#9E5802` (min-w 28, tabular), label 14px 500 + desc 12.5px `#7B7974`, and a Drop/Keep
  segmented control (track bg `#F4F3F0` pill padding 3px; active segment bg `#1B1A18` fg `#FEFDFB`;
  inactive transparent `#7B7974`; both 12.5px display 500 padding 6px 14px).
  1. "Rows that can't be identified" — "Each row needs an email, a name + company, or a LinkedIn
     URL. These have none of those." (NOT "missing email")
  2. "Malformed emails" — "Things like \"s.chen@rampcom\" — cleaned here, before anything reaches Clay."
  3. "Exact duplicates in this file" — "Same person twice. Deduped here, before anything reaches Clay."
  Footer right: "Running {eff} of {total} rows · {dropped} dropped before upload" (mono 12.5 tabular).

### Campaign card (same card chrome, mb 20)
- h2 "Campaign" + mono hint "Search a name or paste a Salesforce ID". Content max-w 560.
- Combobox row: border `#E6E8EC` radius 11 padding 11px 14px, `ph-magnifying-glass` `#7B7974`,
  input 14px transparent; when resolved, right "Found" pill (mono 600 10px uppercase, `#102B03` on
  `#EEF773`, padding 5px 9px 4px).
- **Multi-match** listbox: border `#E6E8EC` radius 12, `--shadow-md`, header bar bg `#F4F3F0`
  (mono 11 uppercase) "{n} campaigns match “{q}” — pick one"; options (role=option, tabbable):
  name 14px 500, meta mono 11.5 `#7B7974` "{Type} · {truncated Id}", status pill
  (Active `#EEF773`/`#102B03`; Completed `#F4F3F0`/`#7B7974`), members "{n} members" mono 11.5
  tabular; hover `#F4F3F0`; separators `#EFF1F3`. Disambiguate by **type + record ID**, never dates.
- **Selected campaign card**: border `#E6E8EC` radius 14 padding 20px 22px bg `#FEFDFB`.
  Name display 500 17px; chips: type (bg `#F4F3F0`, ink) + status; stats: "Members today" (label
  mono 10 uppercase `#7B7974` + value mono 13 tabular) and "Record" → link mono 13 `#B53D0A`
  "{truncated id} ↗" to the Salesforce record; `ph-check-circle` 22px `#808000` top-right.
  Footer (12.5px `#7B7974`, border-top `#EFF1F3`): "This is where {eff} people will land.
  Validated against Salesforce just now — if it's the wrong campaign, now's the moment."
  **Exactly: name, type chip, status chip, record ID, members today. No description, no dates.**

### Review & run (sticky bottom bar, z-30)
White card radius 16 padding 16px 22px `--shadow-md`, flex. Left: "{n} rows" (mono 600 14
tabular) → `ph-arrow-right` → campaign name (14px 500). Right: cost estimate mono 12 `#7B7974`
"≈{2×rows} credits · ≈{chunks} min"; if blocked, reason 12.5px `#B53D0A` 500
("Upload a CSV to start" / "Split the file to under 50,000 rows first"); Start button:
bg `#FF7714`, **fg `#381005`**, display 500 15px, padding 12px 26px, pill, `ph-bold ph-arrow-right`,
hover bg `#f06c0d`, disabled opacity .4 (button carries a disabled-reason slot).
(Prototype used `bottom: 78px` to clear its screen-switcher; production uses ~14–16px.)

## Screen: Run monitor (max-w 1020, padding 28 24 130)

Header: ghost back "← Run history"; H1 run name (display 525 28px) + **status pill**
(role=status, mono 600 11px uppercase, padding 6px 11px 5px, pill, 6px dot):

| key | label | bg | fg | dot | anim |
| --- | --- | --- | --- | --- | --- |
| queued | Queued | #F4F3F0 | #1B1A18 | #7B7974 | — |
| uploading | Uploading | #F0F8FF | #001433 | #429EFF | dotBlink 1.2s |
| validating | Validating | #F0F8FF | #001433 | #429EFF | dotBlink 1.2s |
| running | Running | #EEF773 | #102B03 | #808000 | dotBlink 1.4s |
| finalizing | Finalizing | #F0FCFF | #002833 | #3BD3FD | dotBlink 1.2s |
| stalled | Stalled | #FBE189 | #372201 | #9E5802 | dotBlink 2s |
| done+fails | Completed with failures | #FBE189 | #372201 | #9E5802 | — |
| done clean | Complete | #EEF773 | #102B03 | #808000 | — |

Meta row (mono 12 `#7B7974`): file name, campaign link (`#B53D0A`, ↗), "Started {15 Aug 2026 at
14:32 CT}" (day-first date, 24h + zone), "Elapsed {m:ss}" (tabular, ticking).
Right: "Refresh" pill (border `#E6E8EC`, white, `ph-arrows-clockwise`) over "Updated {just now|Ns
ago}" (mono 11; `#C22E3D` when >15s stale, else `#7B7974`).
Visually-hidden `aria-live="polite"` region announces chunk completions (throttled).

Banners (mt 16):
- **Stalled** (lemon): `ph-hourglass-medium` `#9E5802`; "Nothing has moved for 4 minutes"
  (14 500 `#372201`); "Chunk {n} has been stuck at {x} of {y} rows. Retrying won't touch the rows
  already written." (13 `#9E5802`); black pill "Retry stuck chunks".
- **Rate-limited** (blueberry): border `#BEDFFE` bg `#F0F8FF`; `ph-traffic-cone` `#395AFA`;
  "Clay asked us to slow down" (`#001433`); "Rate limited — the run pauses and resumes on its own.
  Nothing is lost." (`#395AFA`); right: "Resuming in {n}s" mono 600 12 `#001433` tabular.
- **Offline** (oat): border `#D1CDC7` bg `#F4F3F0`; blinking 8px dot `#FB4450`;
  "Connection lost — retrying"; "The numbers below are from {updated}. The run itself keeps going
  on Clay's side."; white pill "Try now".

Progress card (while not done; white, radius 20, padding 30 32 26, mt 18):
- Giant percent: display 525, `clamp(64px, 9vw, 104px)`, lh .9, −0.04em, tabular; "%" display 500
  30px `#7B7974`.
- "{finished} of {total} rows" mono 500 14 tabular; phase hint mono 12 `#7B7974`:
  queued "Waiting for a worker — usually seconds." · uploading "Sending your file to Clay." ·
  validating "Clay is checking every row before spending credits." · running "Enriching in chunks
  of 100 — rows land below as each completes." · finalizing "Wrapping up the last writes to
  Salesforce." · stalled "Paused — see the notice above." · rate-limited "Paused while Clay backs
  off." · offline "Last known state — reconnecting."
- Right, only when honest: rows/min (mono 600 18 tabular, label "rows / min" mono 10.5 uppercase)
  — requires running + live + elapsed > 4s + finished > 0, value rounded to nearest 10;
  "time left" — additionally requires progress > 8% and elapsed > 6s; "< 1 min" or "≈ {n} min".
  **Show nothing rather than a wrong number.**
- Progress bar: h 10 pill, track `#F4F3F0`, fill `#FF7714`, `transition: width .35s cubic-bezier(.2,0,0,1)`.
- **Chunk track** (mt 20): header "Chunks · 100 rows each" + "{a} of {b} complete" (mono 11).
  - ≤14 chunks (discrete): flex gap 8; cells flex-1 h 46 radius 10, chunk number (mono 600 11) +
    "{fin}/{size}" (mono 10, 70% opacity), 1px border.
  - >14 chunks (dense): flex gap 2; cells flex-1 h 16 radius 3, no text, title tooltip only.
  - Cell colors — failed: bg/bd `#FCBABE`, fg `#3A0308` · done: bg/bd `#EEF773`, fg `#576200` ·
    running: bg/bd `#FCC9AB`, fg `#B53D0A` + `chunkPulse 1.5s infinite` (pulse pauses when not
    live) · queued: bg `#F4F3F0`, bd `#E6E8EC`, fg `#7B7974`.
  - Tooltip: "Chunk {n} — complete | running · {x} of {y} | stuck at {x} of {y} | queued | failed".
  - Must look right at 4, 53, and 500 chunks.

Completed summary card (replaces progress card; radius 20, padding 30 32): `Check-A.png` 84×84;
success rate display 525 `clamp(52px, 7vw, 80px)` tabular + "success rate" label; line 15px
"{written} of {total} people written to {campaign}. That's the number for your leadership update.";
meta mono 12 `#7B7974` "{f} failed · {k} skipped (already in campaign) · finished in {m:ss}".
Actions column (min-w 230): tangerine pill "Retry {n} failed rows" (`ph-bold
ph-arrow-counter-clockwise`; only when failures) → white pill "Export results CSV"
(`ph-download-simple`) → row of two flex-1 white pills "Failures only" (only when failures) +
"Run another".

Stat tiles: grid `auto-fit minmax(150px, 1fr)` gap 12 mt 14. Tile: white, border `#E6E8EC`,
radius 14, padding 16px 18px; label mono 500 10.5 uppercase `#7B7974` mb 8; value mono 600 30px
tabular. Tiles: Total · Succeeded · Failed (value `#C22E3D` when > 0) · Skipped · Success rate
("—" until first arrivals; success rate = written ÷ arrived rows). Values count up.

Failures by cause (when any): label + pill per reason (bg `#FFF1F2` fg `#C22E3D`, mono, count 600
+ label), sorted by count desc. Reasons are human sentences, e.g. "Bad email", "No enrichment
match", "Salesforce write rejected", "Rate limited".

Results table (white card radius 16 mt 16): header "Results" (16px 500) + note (mono 11.5):
"Waiting on the first chunk" → "{n} rows in" → "Showing the latest 250 of {n} — the export has
every row". Scroll area max-h 460; table min-w 760, 13px; sticky header (bg `#F4F3F0`, z 2) and
sticky first column (Name, z 3, white bg). Columns: Name (500) · Email (mono 12 `#7B7974`) ·
Phone (mono 12, tabular, "—" when absent) · Status (pill: Written `#EEF773`/`#576200` · Failed
`#FCBABE`/`#3A0308` · Skipped `#FBE189`/`#9E5802`; + reason 12px `#7B7974` inline) · Salesforce
("View ↗" mono 12 `#B53D0A`, or "—" `#D1CDC7`). Empty state: three skeleton bars (62% / 78% / 55%)
+ "Rows land here in batches as each chunk completes — the first batch is on its way."
Rows arrive **newest chunk first**; fresh chunk animates `rowIn .5s` staggered 14ms/row (cap 500ms).
Display cap 250 rows; the export has everything. Skipped reason: "Already in campaign".

## Screen: Batch validation failure (max-w 860)

Back link → H1 "Clay rejected this file before the run started" + pill "Validation failed"
(`#FCBABE`/`#3A0308`). Lede 15px `#7B7974`, bold ink lead-in: "**{n} rows in {file} didn't
validate**, so nothing ran and no credits were spent. Fix the rows below in your spreadsheet, then
upload the corrected file."
Card: toolbar bg `#F4F3F0` — "Showing 100 of {n} errors" (mono 11 uppercase) + "Clay returns
detail for the first 100 lines — the CSV export has the full count." (12.5 `#7B7974`) + white pill
"Download all {n}". Table (max-h 420): Line (right-aligned, 60px, mono tabular) · Field (chip
bg `#F4F3F0` mono 600 9.5 uppercase) · What's wrong (13px ink, human sentences, e.g.
"\"s.chen@rampcom\" is missing a valid domain — did you mean ramp.com?"). Sticky header bg
`#FEFDFB`. Final row: "… {n−100} more in the download" (mono 11.5 `#7B7974`).
Actions: tangerine "Upload the fixed file" (`ph-bold ph-upload-simple`) + white "Download error list".

## Screen: Run history (max-w 1020)

Eyebrow "Your runs" → H1 "Run history"; right: black "New run" pill (only when rows exist).
- **Empty state**: white card radius 20, padding 70 24, centered. `Update-CRM.png` 110×110;
  "No runs yet" (display 500 20px); copy 14.5 `#7B7974` max-w 400: "Upload a badge-scan CSV and
  Event Lead Router enriches every person and writes them into a Salesforce campaign — with
  receipts."; tangerine CTA "Start your first run →".
- Table (min-w 820, 13.5px): Date · File · Campaign · Rows (right) · Success (right) · Status.
  Rows clickable (role=link, tabbable, hover `#F9F8F5`): date mono 12 `#7B7974`
  ("Today, 14:32" / "12 Aug 2026"), file mono 12.5, campaign 500, rows/success mono 12.5 tabular
  (success "—" muted for validation failures), status pills: "Completed with failures"
  `#FBE189`/`#372201` · "Complete" `#EEF773`/`#102B03` · "Validation failed" `#FCBABE`/`#3A0308`.

## Cross-cutting behavior notes

- The prototype's floating dark screen-switcher is reviewer chrome — **not** built in production.
  Every state it reaches must be reachable through real conditions.
- Percent, tiles, elapsed and "updated" timestamps tick client-side between polls.
- ETA/throughput gating is deliberate honesty; keep the exact conditions above.
- Success-rate denominator is **arrived** rows, not total.
- Credit estimate on New run: ≈2 credits/row; time estimate ≈1 min per 100-row chunk.
- Copy discrepancy resolved at build time: the prototype's pre-flight identity description in one
  spot reads "name + email"; the governing identity rule (build prompt §3.4, and the prototype's
  own column-mapping helper) is **email OR name + company OR LinkedIn URL**. All copy follows the
  governing rule.
