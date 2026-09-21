import { describe, expect, it } from "vitest";
import { validateServerEnvironment } from "@/server/config/schema";
import { safeReturnPath } from "@/modules/auth/redirects";
import { canAdminister, roleSchema } from "@/modules/auth/policies";
import { AppError, databaseError, publicError } from "@/server/errors";
const testConfig = { APP_ENV: "test", APP_BASE_URL: "http://localhost:3000", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only_not_a_credential" };
describe("environment boundary", () => {
  it("accepts explicit test public configuration", () => expect(validateServerEnvironment(testConfig).APP_ENV).toBe("test"));
  it("fails without required configuration", () => expect(() => validateServerEnvironment({})).toThrow("Invalid environment"));
  it("does not include invalid values in errors", () => {
    expect(() => validateServerEnvironment({ ...testConfig, APP_BASE_URL: "PRIVATE_SENTINEL" })).toThrow("APP_BASE_URL");
    try { validateServerEnvironment({ ...testConfig, APP_BASE_URL: "PRIVATE_SENTINEL" }); } catch (error) { expect(String(error)).not.toContain("PRIVATE_SENTINEL"); }
  });
  it("rejects secret keys in the public key field", () => expect(() => validateServerEnvironment({ ...testConfig, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_not_for_browser" })).toThrow());
  it("rejects unexpected public variables", () => expect(() => validateServerEnvironment({ ...testConfig, NEXT_PUBLIC_PASSWORD: "private" })).toThrow("allowlisted"));
  it("rejects production config in preview", () => expect(() => validateServerEnvironment({ ...testConfig, APP_ENV: "production", VERCEL_ENV: "preview" })).toThrow());
  it("rejects test/HTTP configuration for production", () => expect(() => validateServerEnvironment({ ...testConfig, APP_ENV: "production" })).toThrow());
  it("strips nonpublic values from validated runtime projection", () => expect(validateServerEnvironment({ ...testConfig, PRIVATE_SENTINEL: "do not return" })).not.toHaveProperty("PRIVATE_SENTINEL"));
});
describe("safe redirects", () => {
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/%2f%2fevil.example", "/workspaces?next=https://evil.example", "javascript:alert(1)", " /invite", "/auth/callback", "/login", null])("rejects %s", (value) => expect(safeReturnPath(value)).toBe("/workspaces"));
  it.each(["/invite", "/workspaces", "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"])("allows %s", (value) => expect(safeReturnPath(value)).toBe(value));
});
describe("role checks", () => {
  it.each(roleSchema.options.filter((role) => role !== "admin"))("%s cannot administer", (role) => expect(canAdminister(role, true, "aal2")).toBe(false));
  it("inactive admin cannot administer", () => expect(canAdminister("admin", false, "aal2")).toBe(false));
  it("admin needs MFA", () => expect(canAdminister("admin", true, "aal1")).toBe(false));
  it("active admin with MFA can administer", () => expect(canAdminister("admin", true, "aal2")).toBe(true));
});
describe("safe errors", () => {
  it("maps database authorization without provider payload", () => expect(databaseError("42501").code).toBe("forbidden"));
  it("maps version conflicts", () => expect(databaseError("40001").code).toBe("conflict"));
  it("does not expose unknown error text", () => expect(JSON.stringify(publicError(new Error("PRIVATE_SENTINEL")))).not.toContain("PRIVATE_SENTINEL"));
  it("preserves a safe error code", () => expect(publicError(new AppError("validation")).code).toBe("validation"));
});
