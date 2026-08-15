import { NextResponse } from "next/server";
import { requireUserForApi } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Signed upload URL: the browser uploads the CSV STRAIGHT to Supabase
 * Storage — never through a route handler (spec §5.2.6). Path is scoped to
 * the session user; the client never picks it.
 */
export async function POST(request: Request) {
  const user = await requireUserForApi();
  if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { fileName?: string };
  const safeName = String(body.fileName ?? "upload.csv").replace(/[^\w.-]/g, "_").slice(0, 120);
  const path = `${user.id}/${crypto.randomUUID()}/${safeName}`;

  const db = createServiceClient();
  const { data, error } = await db.storage.from("uploads").createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: "could not create upload URL" }, { status: 500 });
  }
  return NextResponse.json({ path, token: data.token });
}
