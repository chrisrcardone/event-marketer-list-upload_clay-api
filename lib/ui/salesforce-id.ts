/**
 * True when the text reads as a pasted Salesforce record id (15 or 18
 * alphanumeric chars). Campaign ids start with the 701 key prefix, but the
 * check accepts any object prefix so pastes are recognized immediately.
 */
export function looksLikeSalesforceId(text: string): boolean {
  const t = text.trim();
  return /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(t);
}
