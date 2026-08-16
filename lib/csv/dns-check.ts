import "server-only";
import { lookup } from "node:dns/promises";
import type { LeadRow } from "@/lib/csv/validate";

/**
 * The LinkedIn finder DNS-validates domains and hard-rejects dead ones —
 * a deterministic failure retries can never fix. Strip domains that
 * DEFINITIVELY don't resolve (NXDOMAIN/no-data) before anything reaches
 * Clay; ambiguous outcomes (timeouts, resolver hiccups) keep the domain.
 * Rows keep their company NAME, so they still run — just without a domain
 * to enrich by.
 */
export async function stripDeadDomains(
  leads: LeadRow[],
): Promise<{ leads: LeadRow[]; deadDomains: string[] }> {
  const domains = [...new Set(leads.map((l) => l.company_domain).filter(Boolean))];
  const dead = new Set<string>();
  const CONCURRENCY = 20;

  for (let i = 0; i < domains.length; i += CONCURRENCY) {
    await Promise.all(
      domains.slice(i, i + CONCURRENCY).map(async (domain) => {
        try {
          await Promise.race([
            lookup(domain),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
          ]);
        } catch (cause) {
          const code = (cause as NodeJS.ErrnoException).code;
          if (code === "ENOTFOUND" || code === "ENODATA") dead.add(domain);
        }
      }),
    );
  }

  if (dead.size === 0) return { leads, deadDomains: [] };
  return {
    leads: leads.map((l) => (dead.has(l.company_domain) ? { ...l, company_domain: "" } : l)),
    deadDomains: [...dead],
  };
}
