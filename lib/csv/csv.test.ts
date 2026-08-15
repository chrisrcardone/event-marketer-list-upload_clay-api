import { describe, expect, it } from "vitest";
import { parseCsv, stripBom } from "./parse";
import { autoMapHeaders, normalizeHeader } from "./synonyms";
import { dedupeKey, extractLeads, hasIdentity, isMalformedEmail, preflight, type LeadRow } from "./validate";
import { planRun, estimate } from "@/lib/runs/plan";
import { redact } from "@/lib/log";

const lead = (over: Partial<LeadRow>): LeadRow => ({
  line: 2,
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  company: "",
  title: "",
  linkedin_url: "",
  ...over,
});

describe("parseCsv", () => {
  it("strips a UTF-8 BOM so the first header maps", () => {
    const { text, hadBom } = stripBom("﻿email\na@b.com");
    expect(hadBom).toBe(true);
    const csv = parseCsv("﻿email,name\na@b.com,Ada");
    expect(csv.hadBom).toBe(true);
    expect(csv.headers[0]).toBe("email");
    expect(text.startsWith("email")).toBe(true);
  });

  it("auto-detects semicolons and tabs", () => {
    expect(parseCsv("a;b\n1;2").delimiter).toBe(";");
    expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
  });

  it("handles quoted commas and quotes", () => {
    const csv = parseCsv('name,company\n"Lovelace, Ada","Acme ""Labs"""');
    expect(csv.rows[0].name).toBe("Lovelace, Ada");
    expect(csv.rows[0].company).toBe('Acme "Labs"');
  });

  it("preserves original CSV line numbers, skipping blank lines", () => {
    const csv = parseCsv("email\n\na@b.com\n\nb@c.com");
    expect(csv.lineNumbers).toEqual([3, 5]);
  });
});

describe("header synonyms", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeHeader("E-mail Address")).toBe("emailaddress");
  });
  it("maps common badge-scan headers", () => {
    const map = autoMapHeaders(["First Name", "LAST_NAME", "Work Email", "Company Name", "Job Title", "LinkedIn Profile", "Mobile Phone"]);
    expect(map).toEqual({
      first_name: "First Name",
      last_name: "LAST_NAME",
      email: "Work Email",
      company: "Company Name",
      title: "Job Title",
      linkedin_url: "LinkedIn Profile",
      phone: "Mobile Phone",
    });
  });
  it("never maps one header to two fields", () => {
    const map = autoMapHeaders(["email"]);
    expect(Object.values(map).filter(Boolean)).toEqual(["email"]);
  });
});

describe("the one-of-three identity rule (email is NOT required)", () => {
  it("email alone is an identity", () => {
    expect(hasIdentity(lead({ email: "a@b.com" }))).toBe(true);
  });
  it("name + company is an identity without email", () => {
    expect(hasIdentity(lead({ first_name: "Ada", last_name: "Lovelace", company: "Acme" }))).toBe(true);
  });
  it("linkedin alone is an identity", () => {
    expect(hasIdentity(lead({ linkedin_url: "https://linkedin.com/in/ada" }))).toBe(true);
  });
  it("partial name + company is NOT an identity", () => {
    expect(hasIdentity(lead({ first_name: "Ada", company: "Acme" }))).toBe(false);
  });
  it("a malformed email is not an identity by itself", () => {
    expect(hasIdentity(lead({ email: "s.chen@rampcom" }))).toBe(false);
  });
  it("a malformed email doesn't sink a row with another identity", () => {
    expect(hasIdentity(lead({ email: "s.chen@rampcom", linkedin_url: "linkedin.com/in/schen" }))).toBe(true);
  });
});

describe("malformed emails", () => {
  it.each(["s.chen@rampcom", "marcus.okafor@", "a b@c.com", "priya@@figma.com", "@x.com"]) (
    "flags %s",
    (email) => expect(isMalformedEmail(email)).toBe(true),
  );
  it("accepts normal addresses and treats absence as not-malformed", () => {
    expect(isMalformedEmail("a.b+tag@sub.domain.co")).toBe(false);
    expect(isMalformedEmail("")).toBe(false);
  });
});

describe("preflight — cleaned app-side before anything reaches Clay", () => {
  const rows: LeadRow[] = [
    lead({ line: 2, email: "a@b.com", first_name: "Ada", last_name: "L", company: "Acme" }),
    lead({ line: 3, email: "A@B.COM" }), // exact duplicate of line 2 by email
    lead({ line: 4, email: "bad@no", first_name: "Bo", last_name: "K", company: "Beta" }), // malformed but identifiable
    lead({ line: 5 }), // no identity at all
    lead({ line: 6, linkedin_url: "https://linkedin.com/in/x" }),
  ];

  it("counts each bucket honestly", () => {
    const f = preflight(rows.map((r) => ({ ...r, email: r.email.toLowerCase() })), {
      unidentified: true,
      malformed: true,
      duplicates: true,
    });
    expect(f.malformedEmail.map((r) => r.line)).toEqual([4]);
    expect(f.unidentified.map((r) => r.line)).toEqual([5]);
    expect(f.duplicates.map((r) => r.line)).toEqual([3]);
    // clean = 2 (first occurrence), 4 (email cleaned, still identified), 6
    expect(f.clean.map((r) => r.line)).toEqual([2, 4, 6]);
    expect(f.clean.find((r) => r.line === 4)?.email).toBe(""); // cleaned
  });

  it("keep-choices keep rows without sending dirty data", () => {
    const f = preflight(rows.map((r) => ({ ...r, email: r.email.toLowerCase() })), {
      unidentified: false,
      malformed: true,
      duplicates: false,
    });
    expect(f.clean.map((r) => r.line)).toEqual([2, 3, 4, 5, 6]);
    expect(f.clean.every((r) => !r.email || !isMalformedEmail(r.email))).toBe(true);
  });

  it("dedupe keys normalize case and trailing slashes", () => {
    expect(dedupeKey(lead({ email: "A@B.com" }))).toBe(dedupeKey(lead({ email: "a@b.com" })));
    expect(dedupeKey(lead({ linkedin_url: "https://x.com/in/a/" }))).toBe(
      dedupeKey(lead({ linkedin_url: "https://x.com/in/a" })),
    );
  });
});

describe("chunking math at the boundaries (spec §4.1)", () => {
  const cfg = { chunkSize: 100, maxInlineTotalRows: 5000, maxBatchRows: 50000 };
  it("100 rows → one inline chunk", () => {
    const p = planRun(100, cfg);
    expect("mode" in p && p.mode).toBe("inline");
    expect("chunks" in p && p.chunks.length).toBe(1);
  });
  it("101 rows → two inline chunks (100 + 1)", () => {
    const p = planRun(101, cfg);
    if (!("chunks" in p)) throw new Error("rejected");
    expect(p.chunks.length).toBe(2);
    expect(p.chunks[1]).toEqual({ index: 1, rowStart: 100, rowCount: 1 });
  });
  it("5000 rows → 50 inline chunks; 5001 → batch", () => {
    const p1 = planRun(5000, cfg);
    expect("chunks" in p1 && p1.chunks.length).toBe(50);
    const p2 = planRun(5001, cfg);
    expect("mode" in p2 && p2.mode).toBe("batch");
  });
  it("50001 rows → rejected with guidance", () => {
    const p = planRun(50001, cfg);
    expect("rejected" in p).toBe(true);
  });
  it("estimates ≈2 credits/row and ≈1 min per chunk", () => {
    expect(estimate(412)).toEqual({ credits: 824, minutes: 5 });
  });
});

describe("log redaction — no emails or phone numbers in logs", () => {
  it("redacts emails and phone numbers from strings", () => {
    const out = redact("ada@example.com called from +1 (512) 555-0134 about chris.c@clay.com");
    expect(out).not.toContain("ada@example.com");
    expect(out).not.toContain("555-0134");
    expect(out).toContain("[email]");
    expect(out).toContain("[phone]");
  });
});
