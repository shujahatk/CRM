import {test,expect} from '@playwright/test';
for(const route of ['reports','eod'])test(`unauthenticated ${route} is protected`,async({page})=>{await page.goto(`/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${route}`);await expect(page).toHaveURL(/\/login\?next=/);await expect(page.getByRole('heading',{name:/sign in/i})).toBeVisible();});
