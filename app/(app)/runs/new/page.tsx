import type { Metadata } from "next";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "New run" };

/**
 * New run — header per the design; the upload, campaign, and review
 * sections land in Phase 5 on top of the Phase 3/4 pipeline.
 */
export default function NewRunPage() {
  return (
    <main className="mx-auto max-w-[1020px] px-6 pb-[150px] pt-9">
      <div className="t-eyebrow-sm mb-[10px]">New run</div>
      <h1
        className="t-display m-0 mb-[30px] text-[32px] leading-none tracking-[-0.025em]"
        style={{ fontWeight: 525 }}
      >
        Upload scans, pick a campaign, go
      </h1>
      <Card className="px-7 py-[26px]">
        <p className="m-0 text-[14.5px] text-oat-400" style={{ textWrap: "pretty" }}>
          The upload, campaign, and review flow arrives in Phase 5, wired to the real CSV
          pipeline and Clay client. Until then, the component gallery at{" "}
          <code className="t-mono text-[13px] text-oat-500">/dev/components</code> shows every
          piece of this screen in every state.
        </p>
      </Card>
    </main>
  );
}
