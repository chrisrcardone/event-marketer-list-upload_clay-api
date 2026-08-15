import { describe, expect, it } from "vitest";
import { fmtAgo, fmtElapsed, fmtInt, truncateSfId } from "./format";
import { looksLikeSalesforceId } from "@/lib/ui/salesforce-id";

describe("fmtElapsed", () => {
  it("renders m:ss", () => {
    expect(fmtElapsed(0)).toBe("0:00");
    expect(fmtElapsed(5)).toBe("0:05");
    expect(fmtElapsed(252)).toBe("4:12");
  });
});

describe("fmtInt", () => {
  it("groups thousands with commas", () => {
    expect(fmtInt(1204)).toBe("1,204");
    expect(fmtInt(52318)).toBe("52,318");
  });
});

describe("fmtAgo", () => {
  it('says "just now" under 3s, then Ns ago', () => {
    expect(fmtAgo(0)).toBe("just now");
    expect(fmtAgo(2)).toBe("just now");
    expect(fmtAgo(38)).toBe("38s ago");
  });
});

describe("truncateSfId", () => {
  it("shows the design's 5…5 form for long ids", () => {
    expect(truncateSfId("701Kd00000rTHcQAJ0")).toBe("701Kd…cQAJ0");
    expect(truncateSfId("short")).toBe("short");
  });
});

describe("looksLikeSalesforceId", () => {
  it("accepts 15- and 18-char alphanumeric record ids", () => {
    expect(looksLikeSalesforceId("701Kd00000rTHcQ")).toBe(true);
    expect(looksLikeSalesforceId("701Kd00000rTHcQAJ0")).toBe(true);
    expect(looksLikeSalesforceId("  701Kd00000rTHcQAJ0  ")).toBe(true);
  });
  it("rejects name queries and malformed ids", () => {
    expect(looksLikeSalesforceId("sxsw")).toBe(false);
    expect(looksLikeSalesforceId("SXSW 2026 — Booth Leads")).toBe(false);
    expect(looksLikeSalesforceId("701Kd00000rTHcQA")).toBe(false); // 16 chars
    expect(looksLikeSalesforceId("701Kd00000rTHcQ!")).toBe(false);
  });
});
