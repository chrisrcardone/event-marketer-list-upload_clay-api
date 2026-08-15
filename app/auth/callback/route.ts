import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import { REJECTED_EMAIL_COOKIE } from "@/lib/auth/rejected-cookie";

export const dynamic = "force-dynamic";

/** Hook rejections arrive as "EMAIL_DOMAIN_NOT_ALLOWED:<email>" (or
 *  EMAIL_NOT_VERIFIED:<email>) in error_description. */
function rejectedEmailFrom(description: string | null): string | null {
  if (!description) return null;
  const m = description.match(/EMAIL_(?:DOMAIN_NOT_ALLOWED|NOT_VERIFIED):(\S*)/);
  return m ? m[1] : null;
}

/**
 * OAuth code exchange. Success → /runs. A before-user-created hook
 * rejection (layer 1) → the designed rejected-domain screen, with the
 * attempted email carried in a short-lived cookie (never a URL param).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/runs";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/runs";

  // Vercel/proxy-safe absolute redirect base (documented Supabase pattern).
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV === "development"
      ? origin
      : forwardedHost
        ? `https://${forwardedHost}`
        : origin;

  const rejectedEmail = rejectedEmailFrom(searchParams.get("error_description"));
  if (rejectedEmail !== null) {
    const res = NextResponse.redirect(`${base}/auth/rejected`);
    res.cookies.set(REJECTED_EMAIL_COOKIE, rejectedEmail, {
      maxAge: 300,
      httpOnly: true,
      sameSite: "lax",
      path: "/auth",
    });
    return res;
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Defense in depth: even with a session, a disallowed domain goes to
      // the rejected screen (layer 2 will keep it there).
      const email = data.user?.email ?? null;
      if (!isEmailAllowed(email)) {
        return NextResponse.redirect(`${base}/auth/rejected`);
      }
      return NextResponse.redirect(`${base}${safeNext}`);
    }
  }

  // No code / unexpected error: back to sign-in.
  return NextResponse.redirect(`${base}/`);
}
