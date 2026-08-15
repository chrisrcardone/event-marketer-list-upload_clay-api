import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isEmailAllowed, verifiedEmailFromClaims } from "@/lib/auth/allowlist";
import {
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/env";

/**
 * Next.js proxy (né middleware) — layer 2 of the domain allowlist and the
 * Supabase session refresher. Runs on every request except the public
 * matcher exclusions below; the excluded API routes carry their own
 * protection (webhook: HMAC signature; cron: CRON_SECRET bearer).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Forks that haven't configured Supabase yet can still browse the
  // sign-in shell and the dev gallery; everything else bounces home.
  if (!isSupabaseConfigured()) {
    if (pathname === "/" || pathname.startsWith("/auth/") || pathname.startsWith("/dev/")) {
      return NextResponse.next({ request });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Refreshes the auth token; do not run other logic between client
  // creation and this call (per Supabase SSR guidance).
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;
  const email = verifiedEmailFromClaims(claims);
  const allowed = Boolean(claims) && isEmailAllowed(email);

  const isAuthPath = pathname.startsWith("/auth/");
  const isPublicPath = pathname === "/" || isAuthPath || pathname.startsWith("/dev/");

  // A session whose domain is not (or no longer) allowed only ever sees the
  // rejected screen and the sign-out route.
  if (claims && !allowed && pathname !== "/auth/rejected" && pathname !== "/auth/signout") {
    return NextResponse.redirect(new URL("/auth/rejected", request.url));
  }
  // Guests only see sign-in, the auth routes, and the dev gallery.
  if (!claims && !isPublicPath) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  // Signed-in users skip the sign-in screen.
  if (claims && allowed && pathname === "/") {
    return NextResponse.redirect(new URL("/runs", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - Next internals and static assets
     *  - /api/webhooks/* (Clay webhook — HMAC-verified, no session)
     *  - /api/cron/*     (Vercel Cron — CRON_SECRET bearer, no session)
     *  - /api/health     (unauthenticated liveness probe)
     */
    "/((?!_next/static|_next/image|api/webhooks/|api/cron/|api/health|brand/|fonts/|icon.png|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
