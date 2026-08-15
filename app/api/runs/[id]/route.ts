import { NextResponse } from "next/server";
import { requireUserForApi } from "@/lib/auth/session";
import { pollStep } from "@/lib/runs/orchestrate";

export const maxDuration = 60;

/** The poll target. The client NEVER talks to Clay (spec §4.3); this
 *  endpoint advances the run at most once per POLL_INTERVAL_MS no matter
 *  how many tabs are open, then returns the current view. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserForApi();
  if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  const view = await pollStep(user.id, id);
  if (!view) return NextResponse.json({ error: "run not found" }, { status: 404 });
  return NextResponse.json(view);
}
