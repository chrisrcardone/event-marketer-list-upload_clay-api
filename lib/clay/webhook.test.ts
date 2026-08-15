import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhookPayload, verifyClaySignature } from "./webhook";

const SECRET = "whsec_test_secret";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyClaySignature", () => {
  const body = JSON.stringify({
    webhookId: "wh_1",
    createdAt: "2026-08-15T00:00:00Z",
    data: { routine_run_id: "run_1" },
  });

  it("accepts a correctly signed raw body", () => {
    expect(verifyClaySignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body (signature computed over different bytes)", () => {
    const tampered = body.replace("run_1", "run_2");
    expect(verifyClaySignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("rejects a re-serialized body — the HMAC covers the EXACT raw string", () => {
    const reserialized = JSON.stringify(JSON.parse("{ \"webhookId\": \"wh_1\",  \"createdAt\": \"2026-08-15T00:00:00Z\", \"data\": {} }"));
    const original = "{ \"webhookId\": \"wh_1\",  \"createdAt\": \"2026-08-15T00:00:00Z\", \"data\": {} }";
    expect(verifyClaySignature(original, sign(original), SECRET)).toBe(true);
    expect(verifyClaySignature(reserialized, sign(original), SECRET)).toBe(false);
  });

  it("rejects the wrong secret, malformed headers, and absent headers", () => {
    expect(verifyClaySignature(body, sign(body, "whsec_other"), SECRET)).toBe(false);
    expect(verifyClaySignature(body, "sha256=nothex", SECRET)).toBe(false);
    expect(verifyClaySignature(body, sign(body).slice(7), SECRET)).toBe(false); // missing prefix
    expect(verifyClaySignature(body, null, SECRET)).toBe(false);
    expect(verifyClaySignature(body, sign(body), "")).toBe(false);
  });
});

describe("parseWebhookPayload", () => {
  it("parses a real delivery", () => {
    const p = parseWebhookPayload(
      JSON.stringify({ webhookId: "wh_1", createdAt: "…", data: { routine_run_id: "run_9" } }),
    );
    expect(p?.data.routine_run_id).toBe("run_9");
  });

  it("tolerates test events with data: {}", () => {
    const p = parseWebhookPayload(JSON.stringify({ webhookId: "wh_1", createdAt: "…", data: {} }));
    expect(p).not.toBeNull();
    expect(p?.data.routine_run_id).toBeUndefined();
  });

  it("returns null for garbage without throwing", () => {
    expect(parseWebhookPayload("not json")).toBeNull();
    expect(parseWebhookPayload(JSON.stringify({ nope: 1 }))).toBeNull();
  });
});
