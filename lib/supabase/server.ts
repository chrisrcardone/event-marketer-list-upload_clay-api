import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createBareClient } from "@supabase/supabase-js";
import {
  supabasePublishableKey,
  supabaseSecretKey,
  supabaseUrl,
} from "@/lib/supabase/env";

/**
 * Session-aware server client for Server Components and route handlers.
 * Uses the publishable key: everything it can see is bounded by RLS plus
 * the caller's session cookie.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component: cookie writes are not allowed
          // there. Safe to ignore — the proxy refreshes sessions.
        }
      },
    },
  });
}

/**
 * Service client — RLS bypass. SERVER ONLY: orchestration writes, webhook
 * processing, cron reconciliation. Never holds user session state.
 */
export function createServiceClient() {
  return createBareClient(supabaseUrl(), supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
