import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('funziona offline dopo il primo caricamento (service worker)', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText('PFI', { exact: true })).toBeVisible();
  // attende che il service worker abbia precaricato l'app shell e controlli la pagina
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // crea un dato online
  await page.goto('/#/accounts');
  await page.getByRole('button', { name: 'Nuovo conto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Offline test');
  await page.getByRole('button', { name: 'Crea conto' }).click();
  await expect(page.getByTestId('account-tile')).toHaveCount(1);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('account-tile').filter({ hasText: 'Offline test' })).toBeVisible();
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();

  // le scritture funzionano anche offline
  await page.goto('/#/transactions');
  await page.getByRole('button', { name: 'Nuovo movimento' }).first().click();
  await page.getByLabel('Descrizione', { exact: true }).fill('Caffè offline');
  await page.getByLabel('Importo', { exact: true }).fill('1,20');
  await page.getByRole('button', { name: 'Registra movimento' }).click();
  await expect(page.getByTestId('tx-row')).toHaveCount(1);

  // lettura di un PDF offline (worker pdf.js e font serviti dalla cache)
  await page.goto('/#/import');
  await page.getByTestId('import-file').setInputFiles(join(process.cwd(), 'e2e', 'fixtures', 'estratto-banca.pdf'));
  await expect(page.getByText(/righe lette da 2 pagine/)).toBeVisible();

  // pagine con moduli caricati dinamicamente disponibili offline
  await page.goto('/#/reports');
  await expect(page.getByRole('heading', { name: 'Report e analisi' })).toBeVisible();
  await context.setOffline(false);
});
