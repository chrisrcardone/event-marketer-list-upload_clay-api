import { TopBar } from "@/components/shell/top-bar";

/**
 * Signed-in shell: sticky top bar with the Demo pill on every screen.
 * Phase 2 swaps the placeholder user for the Supabase session user; the
 * sign-in and rejected-domain screens live outside this group and render
 * no chrome.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const user = { name: "Jordan Bell", email: "jordan.bell@clay.com" };
  return (
    <div className="min-h-screen bg-oat-100">
      <TopBar user={user} />
      {children}
    </div>
  );
}
