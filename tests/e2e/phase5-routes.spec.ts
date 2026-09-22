import { test, expect } from '@playwright/test';

for (const route of ['conversations', 'campaigns', 'templates', 'sequences']) {
  test(`unauthenticated /${route} is protected and redirects to login`, async ({ page }) => {
    await page.goto(`/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${route}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });
}

test('authenticated browser mutation E2E workflows', async () => {
  test.skip(true, 'SKIPPED — requires connected Supabase/authenticated integration environment');
});
