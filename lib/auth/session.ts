import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isEmailAllowed, verifiedEmailFromClaims } from "@/lib/auth/allowlist";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

interface SessionClaims {
  sub?: string;
  email?: string;
  user_metadata?: {
    email?: string;
    email_verified?: boolean;
    full_name?: string;
    name?: string;
  };
}

async function claimsFromCookies(): Promise<SessionClaims | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return data.claims as SessionClaims;
}

function toSessionUser(claims: SessionClaims, email: string): SessionUser {
  return {
    id: claims.sub ?? "",
    email,
    name: claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? email,
  };
}

/** Session user if present AND domain-allowed; null otherwise. */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return null;
  const claims = await claimsFromCookies();
  if (!claims) return null;
  const email = verifiedEmailFromClaims(claims);
  if (!email || !isEmailAllowed(email)) return null;
  return toSessionUser(claims, email);
}

/**
 * Layer 3 of the domain allowlist: every session-required route handler and
 * page re-derives the user from the session cookie — never from a request
 * body or query param. Redirects guests to sign-in and disallowed domains
 * to the rejected screen.
 */
export async function requireUser(): Promise<SessionUser> {
  if (!isSupabaseConfigured()) redirect("/");
  const claims = await claimsFromCookies();
  if (!claims) redirect("/");
  const email = verifiedEmailFromClaims(claims);
  if (!email || !isEmailAllowed(email)) redirect("/auth/rejected");
  return toSessionUser(claims, email);
}

/**
 * requireUser for API route handlers: returns null instead of redirecting,
 * so callers can respond 401 (a fetch shouldn't get an HTML redirect).
 */
export async function requireUserForApi(): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return null;
  const claims = await claimsFromCookies();
  if (!claims) return null;
  const email = verifiedEmailFromClaims(claims);
  if (!email || !isEmailAllowed(email)) return null;
  return toSessionUser(claims, email);
}
