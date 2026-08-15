import { NextResponse } from "next/server";
import { clayFromEnv, isClayConfigured } from "@/lib/clay/config";
import { createServiceClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Setup-verification probe (spec §10): database reachability + Clay
 *  GET /me. Public, unauthenticated, reveals nothing sensitive. */
export async function GET() {
  const checks: Record<string, string> = {};

  if (!isSupabaseConfigured()) checks.supabase = "not configured";
  else {
    try {
      const db = createServiceClient();
      const { error } = await db.from("runs").select("id", { head: true, count: "exact" }).limit(1);
      checks.supabase = error ? `error: ${error.message}` : "ok";
    } catch {
      checks.supabase = "unreachable";
    }
  }

  if (!isClayConfigured()) checks.clay = "not configured";
  else {
    const me = await clayFromEnv().getMe();
    checks.clay = me.ok ? "ok" : `error: ${me.error.kind}`;
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ healthy, checks }, { status: healthy ? 200 : 503 });
}
