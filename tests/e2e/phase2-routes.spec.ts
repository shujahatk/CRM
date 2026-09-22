import { expect, test } from "@playwright/test";

const testWorkspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("unauthenticated access to dashboard redirects to login with safe next parameter", async ({ page }) => {
  await page.goto(`/${testWorkspace}/dashboard`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2F${testWorkspace}`));
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
});

test("unauthenticated access to leads directory redirects to login", async ({ page }) => {
  await page.goto(`/${testWorkspace}/leads`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2F${testWorkspace}`));
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
});

test("unauthenticated access to pipeline board redirects to login", async ({ page }) => {
  await page.goto(`/${testWorkspace}/pipeline`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2F${testWorkspace}`));
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
});

test("unauthenticated access to tasks page redirects to login", async ({ page }) => {
  await page.goto(`/${testWorkspace}/tasks`);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2F${testWorkspace}`));
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
});
