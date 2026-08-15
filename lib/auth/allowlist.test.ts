import { describe, expect, it } from "vitest";
import {
  allowedDomainsLabel,
  emailDomain,
  isEmailAllowed,
  parseAllowedDomains,
  verifiedEmailFromClaims,
} from "./allowlist";

describe("parseAllowedDomains", () => {
  it("splits, trims, lowercases, strips leading @", () => {
    expect(parseAllowedDomains(" Clay.com , @claylabs.com ,,")).toEqual([
      "clay.com",
      "claylabs.com",
    ]);
  });
  it("is empty for unset/empty input (fail closed)", () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
    expect(parseAllowedDomains("")).toEqual([]);
    expect(parseAllowedDomains(" , ")).toEqual([]);
  });
});

describe("emailDomain", () => {
  it("takes the substring after the FINAL @", () => {
    expect(emailDomain("user@clay.com")).toBe("clay.com");
    expect(emailDomain('"weird@user"@clay.com')).toBe("clay.com");
  });
  it("lowercases", () => {
    expect(emailDomain("USER@CLAY.COM")).toBe("clay.com");
  });
  it("is empty when there is no usable domain", () => {
    expect(emailDomain("no-at-sign")).toBe("");
    expect(emailDomain("trailing@")).toBe("");
  });
});

describe("isEmailAllowed", () => {
  const domains = ["clay.com"];

  it("allows an exact domain match, case-insensitively", () => {
    expect(isEmailAllowed("maya@clay.com", domains)).toBe(true);
    expect(isEmailAllowed("MAYA@Clay.Com", domains)).toBe(true);
  });

  it("NEVER matches by suffix — evilclay.com ends with clay.com and must fail", () => {
    expect(isEmailAllowed("attacker@evilclay.com", domains)).toBe(false);
    expect(isEmailAllowed("attacker@notclay.com", domains)).toBe(false);
  });

  it("does not match subdomains", () => {
    expect(isEmailAllowed("user@mail.clay.com", domains)).toBe(false);
  });

  it("uses the FINAL @ — a crafted local part can't smuggle a domain", () => {
    expect(isEmailAllowed("user@clay.com@evil.com", domains)).toBe(false);
    expect(isEmailAllowed('"user@evil.com"@clay.com', domains)).toBe(true);
  });

  it("fails closed on an empty allowlist", () => {
    expect(isEmailAllowed("user@clay.com", [])).toBe(false);
  });

  it("rejects missing/blank emails", () => {
    expect(isEmailAllowed(null, domains)).toBe(false);
    expect(isEmailAllowed(undefined, domains)).toBe(false);
    expect(isEmailAllowed("", domains)).toBe(false);
    expect(isEmailAllowed("no-at", domains)).toBe(false);
  });

  it("supports multiple domains", () => {
    const multi = ["clay.com", "claylabs.com"];
    expect(isEmailAllowed("a@claylabs.com", multi)).toBe(true);
    expect(isEmailAllowed("a@clay.com", multi)).toBe(true);
    expect(isEmailAllowed("a@clay.dev", multi)).toBe(false);
  });
});

describe("verifiedEmailFromClaims", () => {
  it("prefers the provider's verified email", () => {
    expect(
      verifiedEmailFromClaims({
        email: "raw@clay.com",
        user_metadata: { email: "verified@clay.com", email_verified: true },
      }),
    ).toBe("verified@clay.com");
  });
  it("returns null when the provider says the email is unverified", () => {
    expect(
      verifiedEmailFromClaims({
        email: "raw@clay.com",
        user_metadata: { email: "raw@clay.com", email_verified: false },
      }),
    ).toBeNull();
  });
  it("falls back to the top-level claim when metadata is absent", () => {
    expect(verifiedEmailFromClaims({ email: "raw@clay.com" })).toBe("raw@clay.com");
    expect(verifiedEmailFromClaims(null)).toBeNull();
  });
});

describe("allowedDomainsLabel", () => {
  it("joins for the sign-in copy", () => {
    expect(allowedDomainsLabel(["clay.com"])).toBe("clay.com");
    expect(allowedDomainsLabel(["clay.com", "claylabs.com"])).toBe(
      "clay.com & claylabs.com",
    );
  });
});
