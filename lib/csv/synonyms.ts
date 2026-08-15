/**
 * Header synonym table — the data file a fork extends (spec §8).
 * Matching happens on normalized headers: lowercased, non-alphanumerics
 * stripped. Every alias below is stored pre-normalized.
 */

export type MappableField =
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "company"
  | "title"
  | "linkedin_url";

export const FIELD_LABELS: Record<MappableField, string> = {
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  title: "Title",
  linkedin_url: "LinkedIn URL",
};

/** Fields that can satisfy the one-of-three identity rule are tagged
 *  "Identity" in the mapping UI; the rest are "Optional". */
export const IDENTITY_FIELDS: ReadonlySet<MappableField> = new Set([
  "first_name",
  "last_name",
  "email",
  "company",
  "linkedin_url",
]);

export const HEADER_SYNONYMS: Record<MappableField, string[]> = {
  first_name: ["firstname", "first", "fname", "givenname", "forename"],
  last_name: ["lastname", "last", "lname", "surname", "familyname"],
  email: ["email", "emailaddress", "workemail", "businessemail", "mail", "emailid"],
  phone: ["phone", "phonenumber", "mobile", "mobilephone", "mobilenumber", "cell", "cellphone", "telephone", "tel", "workphone", "directdial"],
  company: ["company", "companyname", "organization", "organisation", "org", "employer", "account", "accountname", "business"],
  title: ["title", "jobtitle", "role", "position", "designation", "jobrole"],
  linkedin_url: ["linkedin", "linkedinurl", "linkedinprofile", "linkedinlink", "liurl", "linkedinprofileurl"],
};

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Auto-map uploaded headers to fields. First match wins per field;
 *  a header can only serve one field. */
export function autoMapHeaders(headers: string[]): Partial<Record<MappableField, string>> {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const taken = new Set<string>();
  const mapping: Partial<Record<MappableField, string>> = {};
  for (const field of Object.keys(HEADER_SYNONYMS) as MappableField[]) {
    const aliases = new Set(HEADER_SYNONYMS[field]);
    const hit = normalized.find((h) => !taken.has(h.raw) && aliases.has(h.norm));
    if (hit) {
      mapping[field] = hit.raw;
      taken.add(hit.raw);
    }
  }
  return mapping;
}
