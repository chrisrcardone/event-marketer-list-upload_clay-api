import { NextResponse } from "next/server";
import { requireUserForApi } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** Result rows, newest chunk first (per the design), RLS-scoped. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserForApi();
  if (!user) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? 250) || 250);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("run_rows")
    .select("id, original_row_number, chunk_index, name, email, phone, status, failure_reason, salesforce_url")
    .eq("run_id", id)
    .neq("status", "pending")
    .order("chunk_index", { ascending: false, nullsFirst: false })
    .order("original_row_number", { ascending: true })
    .limit(limit);
  if (error) return NextResponse.json({ error: "could not load results" }, { status: 500 });

  const { count } = await supabase
    .from("run_rows")
    .select("id", { count: "exact", head: true })
    .eq("run_id", id)
    .neq("status", "pending");

  return NextResponse.json({
    total: count ?? data.length,
    rows: data.map((r) => ({
      id: r.id,
      originalRowNumber: r.original_row_number,
      chunkIndex: r.chunk_index,
      name: r.name ?? "",
      email: r.email ?? "",
      phone: r.phone ?? "",
      status: r.status,
      reason: r.failure_reason ?? "",
      salesforceUrl: r.salesforce_url ?? "",
    })),
  });
}
