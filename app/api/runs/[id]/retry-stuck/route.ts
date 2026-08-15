import { NextResponse } from "next/server";
import { requireUserForApi } from "@/lib/auth/session";
import { pollStep, retryStuckChunks } from "@/lib/runs/orchestrate";

export const maxDuration = 60;

/** The stalled banner's action: re-queue stuck chunks (rows already written
 *  are never touched — results upsert idempotently). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserForApi();
  if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  const ok = await retryStuckChunks(user.id, id);
  if (!ok) return NextResponse.json({ error: "run not found or already finished" }, { status: 400 });
  const view = await pollStep(user.id, id, true);
  return NextResponse.json(view);
}
