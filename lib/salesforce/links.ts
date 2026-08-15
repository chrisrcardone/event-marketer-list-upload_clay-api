/** Salesforce deep links — built app-side, never returned by Clay (spec §3.3). */

function instanceUrl(): string {
  return (process.env.SALESFORCE_INSTANCE_URL ?? "").replace(/\/$/, "");
}

export function contactLink(contactId: string | null | undefined): string {
  const base = instanceUrl();
  if (!base || !contactId) return "";
  return `${base}/lightning/r/Contact/${contactId}/view`;
}

export function campaignLink(campaignId: string | null | undefined): string {
  const base = instanceUrl();
  if (!base || !campaignId) return "";
  return `${base}/lightning/r/Campaign/${campaignId}/view`;
}

export function campaignMemberLink(memberId: string | null | undefined): string {
  const base = instanceUrl();
  if (!base || !memberId) return "";
  return `${base}/lightning/r/CampaignMember/${memberId}/view`;
}
