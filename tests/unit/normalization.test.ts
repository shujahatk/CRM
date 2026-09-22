import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone } from "@/modules/lead/normalization";

describe("email normalization", () => {
  it("trims and lowercases valid email", () => {
    expect(normalizeEmail("  John.Doe@Example.COM  ")).toBe("john.doe@example.com");
  });

  it("returns null for invalid or empty emails", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail("invalid-email")).toBeNull();
  });
});

describe("phone normalization with country preservation", () => {
  it("converts to E.164 when international + prefix exists", () => {
    const res = normalizePhone("+1 (555) 123-4567");
    expect(res).not.toBeNull();
    expect(res?.normalized).toBe("+15551234567");
    expect(res?.raw).toBe("+1 (555) 123-4567");
    expect(res?.isE164).toBe(true);
  });

  it("converts to E.164 for UK international numbers", () => {
    const res = normalizePhone("+44 20 7946 0958");
    expect(res?.normalized).toBe("+442079460958");
    expect(res?.isE164).toBe(true);
  });

  it("DOES NOT guess a country when international prefix is missing", () => {
    const raw = "555-123-4567";
    const res = normalizePhone(raw);
    expect(res).not.toBeNull();
    // Must NOT guess +1! Must preserve digits without fabricated country code
    expect(res?.normalized).toBe("5551234567");
    expect(res?.normalized).not.toContain("+");
    expect(res?.isE164).toBe(false);
    expect(res?.raw).toBe(raw);
  });

  it("applies country code prefix ONLY when explicitly provided via context", () => {
    const res = normalizePhone("555-123-4567", "+1");
    expect(res?.normalized).toBe("+15551234567");
    expect(res?.isE164).toBe(true);
  });

  it("returns null for null or whitespace-only inputs", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("    ")).toBeNull();
  });
});
