import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRunView } from "@/lib/runs/orchestrate";
import { RunMonitor } from "./monitor";

export const metadata: Metadata = { title: "Run monitor" };

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const view = await getRunView(user.id, id);
  if (!view) notFound();
  return <RunMonitor initial={view} initialRows={[]} />;
}
