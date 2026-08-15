import { NextResponse } from "next/server";
import { z } from "zod";
import { createClayClient } from "@/lib/clay/client";
import { requireUserForApi } from "@/lib/auth/session";
import { looksLikeSalesforceId } from "@/lib/ui/salesforce-id";

export const maxDuration = 60;

const matchesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    status: z.string(),
    is_active: z.boolean(),
    members: z.number(),
    member_statuses: z.array(
      z.object({
        label: z.string().nullish(),
        is_default: z.boolean(),
        has_responded: z.boolean(),
        sort_order: z.number().nullish(),
      }),
    ),
  }),
);

/**
 * Campaign lookup, provider-selectable (spec §7):
 *  - "clay" (default when CLAY_CAMPAIGN_ROUTINE_ID is set): a dedicated
 *    read-only Clay routine runs the Salesforce search — real names, types,
 *    member counts, and available member dispositions, with zero Salesforce
 *    credentials in this app.
 *  - "id-only": format-validates a pasted Campaign id; the Routine's write
 *    is the real validation.
 */
export async function GET(request: Request) {
  const user = await requireUserForApi();
  if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const provider = process.env.SALESFORCE_CAMPAIGN_PROVIDER ?? "clay";
  const routineId = process.env.CLAY_CAMPAIGN_ROUTINE_ID;

  if (provider === "id-only" || !routineId) {
    if (looksLikeSalesforceId(q) && q.startsWith("701")) {
      return NextResponse.json({
        provider: "id-only",
        matches: [{ id: q, name: `Campaign ${q}`, type: "", status: "", is_active: true, members: null, member_statuses: [] }],
      });
    }
    return NextResponse.json({ provider: "id-only", matches: [] });
  }

  const clay = createClayClient({
    apiKey: process.env.CLAY_API_KEY ?? "",
    routineId,
    baseUrl: process.env.CLAY_API_BASE_URL ?? "https://api.clay.com/public/v0",
  });

  const started = await clay.startInlineRun([{ id: "q", inputs: { query: q } }]);
  if (!started.ok) return NextResponse.json({ error: "campaign search unavailable" }, { status: 502 });

  // A short poll loop is fine here: the lookup routine is two SOQL reads.
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, attempt < 4 ? 1200 : 2000));
    const page = await clay.getInlineResultsPage(started.value.routine_run_id);
    if (!page.ok) continue;
    if (page.value.state === "in_progress") continue;
    const item = page.value.terminal.data[0];
    if (!item || item.status === "failed") {
      return NextResponse.json({ error: "campaign search failed" }, { status: 502 });
    }
    const raw = (item.result as { matches_json?: string } | undefined)?.matches_json ?? "[]";
    try {
      const matches = matchesSchema.parse(JSON.parse(raw));
      const base = (process.env.SALESFORCE_INSTANCE_URL ?? "").replace(/\/$/, "");
      const withLinks = matches.map((m) => ({
        ...m,
        url: base ? `${base}/lightning/r/Campaign/${m.id}/view` : "",
      }));
      return NextResponse.json({ provider: "clay", matches: withLinks });
    } catch {
      return NextResponse.json({ error: "campaign search returned an unexpected shape" }, { status: 502 });
    }
  }
  return NextResponse.json({ error: "campaign search timed out" }, { status: 504 });
}
