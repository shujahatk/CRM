import { expect, test } from "@playwright/test";
test("login shell has accessible fields and no mock workspace", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
});
test("unauthenticated workspace is protected", async ({ page }) => {
  await page.goto("/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  await expect(page).toHaveURL(/\/login\?next=/);
});
test("unauthenticated direct membership API is rejected", async ({ request }) => {
  const response = await request.get("/api/v1/workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/memberships");
  expect(response.status()).toBe(401);
});
test("cross-origin direct mutation is rejected", async ({ request }) => {
  const response = await request.patch("/api/v1/workspaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/memberships", {
    headers: { origin: "https://untrusted.example" }, data: { role: "admin" },
  });
  expect(response.status()).toBe(403);
});
test("unsafe redirect cannot leave app", async ({ page }) => {
  await page.goto("/login?next=https://untrusted.example");
  await expect(page.locator('input[name="next"]')).toHaveValue("/workspaces");
});
test("security headers are present", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response.headers()["content-security-policy"]).toContain("'nonce-");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["cache-control"]).toContain("no-store");
});
