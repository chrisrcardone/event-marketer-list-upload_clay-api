/**
 * The domain allowlist — the access-control core, enforced in four layers:
 *   1. Supabase before-user-created hook (supabase/migrations, in Postgres)
 *   2. proxy.ts on every request
 *   3. requireUser() in every session-required route handler
 *   4. RLS policies via public.current_email_domain_allowed()
 * This module is the single implementation layers 2 and 3 share.
 *
 * Rules (each has a test):
 *   · Fail closed: unset/empty ALLOWED_EMAIL_DOMAINS denies everyone.
 *   · Exact match on the substring after the FINAL @, lowercased —
 *     never endsWith ("evilclay.com" must not match "clay.com").
 */

export function parseAllowedDomains(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function allowedDomains(): string[] {
  return parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);
}

/** The substring after the final @, lowercased. "" when there is no @. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return "";
  return email.slice(at + 1).toLowerCase();
}

export function isEmailAllowed(
  email: string | null | undefined,
  domains: string[] = allowedDomains(),
): boolean {
  if (domains.length === 0) return false; // fail closed
  if (!email) return false;
  const domain = emailDomain(email);
  if (!domain) return false;
  return domains.includes(domain);
}

/** True when the allowlist itself is unconfigured (the setup-error state). */
export function allowlistUnconfigured(): boolean {
  return allowedDomains().length === 0;
}

/** "clay.com accounts only" / "clay.com & example.com accounts only". */
export function allowedDomainsLabel(domains: string[] = allowedDomains()): string {
  if (domains.length === 0) return "no domains configured";
  return domains.join(" & ");
}

interface ClaimsLike {
  email?: string;
  user_metadata?: { email?: string; email_verified?: boolean };
}

/**
 * The email an access decision may trust: prefer the provider's
 * verified-email claim over the raw profile email. An explicitly
 * unverified email yields null (treated as denied).
 */
export function verifiedEmailFromClaims(claims: ClaimsLike | null | undefined): string | null {
  if (!claims) return null;
  const meta = claims.user_metadata;
  if (meta && meta.email_verified === false) return null;
  return meta?.email ?? claims.email ?? null;
}
