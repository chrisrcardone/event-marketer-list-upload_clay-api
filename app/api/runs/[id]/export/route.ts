import { requireUserForApi } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

function csvEscape(v: string): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/**
 * Streamed CSV export — never buffers the full result set into a string
 * (spec §8): rows are paged out of Postgres and enqueued as they arrive.
 * ?filter=failed exports failures only.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserForApi();
  if (!user) return new Response("sign in required", { status: 401 });
  const { id } = await params;
  const filter = new URL(request.url).searchParams.get("filter") === "failed" ? "failed" : "all";

  const supabase = await createClient();
  const { data: run } = await supabase.from("runs").select("run_name").eq("id", id).single();
  if (!run) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          "csv_line,name,email,phone,company,company_domain,title,linkedin_url,status,failure_reason,salesforce_url\n",
        ),
      );
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        let query = supabase
          .from("run_rows")
          .select("original_row_number,name,email,phone,company,company_domain,title,linkedin_url,status,failure_reason,salesforce_url")
          .eq("run_id", id)
          .neq("status", "pending")
          .order("original_row_number")
          .range(offset, offset + pageSize - 1);
        if (filter === "failed") query = query.eq("status", "failed");
        const { data, error } = await query;
        if (error || !data || data.length === 0) break;
        const lines = data
          .map((r) =>
            [
              String(r.original_row_number),
              csvEscape(r.name ?? ""),
              csvEscape(r.email ?? ""),
              csvEscape(r.phone ?? ""),
              csvEscape(r.company ?? ""),
              csvEscape(r.company_domain ?? ""),
              csvEscape(r.title ?? ""),
              csvEscape(r.linkedin_url ?? ""),
              r.status,
              csvEscape(r.failure_reason ?? ""),
              csvEscape(r.salesforce_url ?? ""),
            ].join(","),
          )
          .join("\n");
        controller.enqueue(encoder.encode(lines + "\n"));
        if (data.length < pageSize) break;
      }
      controller.close();
    },
  });

  const slug = String(run.run_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const suffix = filter === "failed" ? "-failures" : "-results";
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug || "run"}${suffix}.csv"`,
      "cache-control": "no-store",
    },
  });
}
