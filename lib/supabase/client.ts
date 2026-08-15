"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/** Browser client (publishable key; access constrained by RLS). */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
