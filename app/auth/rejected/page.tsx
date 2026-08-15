import type { Metadata } from "next";
import Image from "next/image";
import { cookies } from "next/headers";
import { HandPalm } from "@phosphor-icons/react/dist/ssr";
import {
  allowedDomainsLabel,
  allowlistUnconfigured,
  isEmailAllowed,
  verifiedEmailFromClaims,
} from "@/lib/auth/allowlist";
import { REJECTED_EMAIL_COOKIE } from "@/lib/auth/rejected-cookie";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "That account won't work here" };

/**
 * Rejected domain — a policy outcome, not an error: no red, no stack
 * traces, per the design. Reached two ways:
 *   · the before-user-created hook blocked the signup (email arrives via a
 *     short-lived cookie set by the OAuth callback), or
 *   · an existing session's domain isn't allowed (email from the session).
 */
export default async function RejectedPage() {
  const cookieStore = await cookies();
  const cookieEmail = cookieStore.get(REJECTED_EMAIL_COOKIE)?.value || null;

  let sessionEmail: string | null = null;
  if (!cookieEmail && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const email = verifiedEmailFromClaims(data?.claims ?? null);
    if (email && !isEmailAllowed(email)) sessionEmail = email;
  }

  const email = cookieEmail ?? sessionEmail;
  const unconfigured = allowlistUnconfigured();

  return (
    <div className="flex min-h-screen items-center justify-center bg-oat-100 p-6">
      <div className="flex w-full max-w-[440px] flex-col items-center text-center">
        <Image
          src="/brand/Clay_Logo_3D_Blk.png"
          alt="Clay"
          width={125}
          height={44}
          priority
          className="mb-9 h-11 w-auto object-contain"
        />
        <div className="flex flex-col items-center rounded-[20px] border border-hairline bg-white px-9 py-10">
          <div className="mb-5 flex size-11 items-center justify-center rounded-[14px] bg-oat-200">
            <HandPalm aria-hidden="true" size={22} className="text-oat-400" />
          </div>
          <h1
            className="t-display m-0 mb-3 text-[26px] leading-[1.1] tracking-[-0.02em]"
            style={{ fontWeight: 525 }}
          >
            That account won&rsquo;t work here
          </h1>
          {unconfigured ? (
            <p
              className="m-0 mb-[26px] text-[14.5px] leading-relaxed text-oat-400"
              style={{ textWrap: "pretty" }}
            >
              No sign-ins are possible right now: {" "}
              <span className="font-medium text-oat-500">ALLOWED_EMAIL_DOMAINS</span> is
              empty, so the app fails closed. An admin needs to set it and redeploy.
            </p>
          ) : (
            <>
              <p
                className="m-0 mb-2 text-[14.5px] leading-relaxed text-oat-400"
                style={{ textWrap: "pretty" }}
              >
                {email ? (
                  <>
                    You signed in as{" "}
                    <span className="font-medium text-oat-500">{email}</span>.{" "}
                  </>
                ) : null}
                Event Lead Router is limited to{" "}
                <span className="font-medium text-oat-500">
                  @{allowedDomainsLabel()}
                </span>{" "}
                Google accounts.
              </p>
              <p className="m-0 mb-[26px] text-[14.5px] leading-relaxed text-oat-400">
                Nothing&rsquo;s broken — it&rsquo;s just the guest list.
              </p>
            </>
          )}
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="cursor-pointer rounded-pill border-0 bg-oat-500 px-[22px] py-[11px] font-display text-[14.5px] font-medium text-oat-100 transition-opacity duration-[120ms] hover:opacity-90"
            >
              Use a different account
            </button>
          </form>
        </div>
        <p className="m-0 mt-[18px] text-[12.5px] text-oat-400">
          Think you should have access? Ask in #gtm-engineering.
        </p>
      </div>
    </div>
  );
}
