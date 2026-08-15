import { redirect } from "next/navigation";
import { TopBar } from "@/components/shell/top-bar";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * Signed-in shell: sticky top bar with the Demo pill on every screen.
 * The proxy already gates these routes; this layout re-derives the user
 * for display. In development without Supabase configured, the dev
 * gallery stays reachable with a placeholder user.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user = await getSessionUser();

  if (!user) {
    const devFallbackOk =
      process.env.NODE_ENV !== "production" && !isSupabaseConfigured();
    if (devFallbackOk) {
      user = { id: "dev", name: "Jordan Bell", email: "jordan.bell@clay.com" };
    } else {
      redirect("/");
    }
  }

  return (
    <div className="min-h-screen bg-oat-100">
      <TopBar user={user} />
      {children}
    </div>
  );
}
