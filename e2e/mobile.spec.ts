import { expect, test } from '@playwright/test';

test('layout mobile: navigazione a scomparsa e nessuno scroll orizzontale', async ({ page }) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Apri menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await page.getByRole('link', { name: 'Conti' }).click();
  await expect(page.locator('.header-title')).toContainText('Conti');

  await page.getByRole('button', { name: 'Nuovo conto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Mobile');
  await page.getByLabel('Saldo iniziale', { exact: true }).fill('250');
  await page.getByRole('button', { name: 'Crea conto' }).click();
  await expect(page.getByTestId('account-tile')).toHaveCount(1);

  for (const route of ['dashboard', 'accounts', 'transactions', 'import', 'banks', 'budgets', 'goals', 'investments', 'reports', 'assistant', 'settings']) {
    await page.goto(`/#/${route}`);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `scroll orizzontale su ${route}`).toBeLessThanOrEqual(1);
  }
});
