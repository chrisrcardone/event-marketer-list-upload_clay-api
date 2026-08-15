import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import {
  allowedDomainsLabel,
  allowlistUnconfigured,
} from "@/lib/auth/allowlist";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Sign in · Event Lead Router" };

/**
 * Sign in — Google only, no chrome (no top bar). Matches the prototype's
 * sign-in screen including the required demo disclaimer line.
 */
export default async function SignInPage() {
  const user = await getSessionUser();
  if (user) redirect("/runs");

  const configured = isSupabaseConfigured();
  const unconfiguredAllowlist = allowlistUnconfigured();

  return (
    <div className="flex min-h-screen items-center justify-center bg-oat-100 p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center text-center">
        <Image
          src="/brand/Clay_Logo_3D_Blk.png"
          alt="Clay"
          width={125}
          height={44}
          priority
          className="mb-9 h-11 w-auto object-contain"
        />
        <div className="t-eyebrow-sm mb-[14px]">Internal tool</div>
        <h1
          className="t-display m-0 mb-[14px] text-[40px] leading-[1.02] tracking-[-0.03em]"
          style={{ fontWeight: 525 }}
        >
          Event Lead Router
        </h1>
        <p
          className="m-0 mb-9 max-w-[320px] text-[16px] leading-normal text-oat-400"
          style={{ textWrap: "pretty" }}
        >
          Badge scans in. Enriched, deduped leads in your Salesforce campaign — with a
          number you can stand behind.
        </p>

        <GoogleSignInButton configured={configured} />

        {unconfiguredAllowlist ? (
          <p className="mt-[22px] max-w-[320px] text-[12.5px] font-medium text-tangerine-400">
            Setup needed: ALLOWED_EMAIL_DOMAINS is empty, so no one can sign in. Set it in
            the environment and redeploy.
          </p>
        ) : (
          <p className="t-mono m-0 mt-[22px] text-[11px] font-medium uppercase tracking-[.06em] text-oat-400">
            {allowedDomainsLabel()} accounts only
          </p>
        )}

        {/* Required demo disclaimer — do not remove or soften. */}
        <p
          className="m-0 mt-[14px] max-w-[320px] text-[12.5px] text-oat-400"
          style={{ textWrap: "pretty" }}
        >
          This is a demo built to show what a Clay-powered workflow can do — not an
          official Clay internal tool.
        </p>
      </div>
    </div>
  );
}
