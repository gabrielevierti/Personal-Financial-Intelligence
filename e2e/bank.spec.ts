import { expect, test } from '@playwright/test';

test('collegamento bancario in sola lettura: autorizzazione, associazione, sincronizzazione, revoca', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/#/banks');
  // bridge predefinito (8787) assente: stato non raggiungibile
  await expect(page.getByTestId('bridge-status')).toContainText('Bridge non raggiungibile');
  await page.getByLabel('Indirizzo del bridge', { exact: true }).fill('http://127.0.0.1:8788');
  await page.locator('#bridge-url').locator('..').getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByTestId('bridge-status')).toContainText('Bridge pronto');
  await expect(page.getByTestId('bridge-status')).toContainText('sandbox');

  await page.getByTestId('connect-bank').click();
  await page.getByLabel('Banca', { exact: true }).fill('fine');
  await page.getByRole('option', { name: /Fineco/ }).click();
  await page.getByTestId('start-auth').click();

  // la banca simulata reindirizza all'app con code e state: il collegamento si completa da solo
  await expect(page.getByText(/Fineco collegata/)).toBeVisible();
  await expect(page).toHaveURL(/#\/banks$/);
  await expect(page.getByLabel('Salva i movimenti in')).toHaveValue('new');
  await page.getByTestId('save-links').click();
  await expect(page.getByText('Sincronizzazione completata: 5 nuovi movimenti.')).toBeVisible();
  await expect(page.getByTestId('bank-link')).toContainText('allineati');
  // il movimento in attesa (20 €) è incluso: saldo disponibile come nell'app della banca
  await expect(page.getByTestId('pending-info')).toContainText('1 movimento in attesa');
  await expect(page.getByTestId('pending-info')).toContainText('2.986,65');
  // tutti i saldi forniti dalla banca, con scelta del riferimento
  await page.getByText(/Saldi forniti dalla banca \(3\)/).click();
  await page.getByRole('radio', { name: /saldo disponibile/i }).check();
  await expect(page.getByTestId('balance-compare')).toContainText('con i movimenti in attesa');
  await expect(page.getByTestId('bank-link')).toContainText('allineati');

  await page.goto('/#/accounts');
  const bal = await page.getByTestId('account-tile').filter({ hasText: 'Conto Fineco' }).getByTestId('account-balance').textContent();
  expect((bal ?? '').replace(/\s/g, ' ')).toContain('2.986,65');
  await page.goto('/#/transactions');
  await page.getByLabel('Periodo', { exact: true }).selectOption('last_3_months');
  await expect(page.getByTestId('tx-row')).toHaveCount(6);
  await expect(page.getByTestId('tx-table')).toContainText('ACME SRL · Stipendio');
  await expect(page.getByTestId('tx-table')).toContainText('In attesa');

  await page.goto('/#/banks');
  await page.getByTestId('sync-all').click();
  await expect(page.getByText('Sincronizzazione completata: nessun nuovo movimento.')).toBeVisible();

  await page.getByRole('button', { name: 'Revoca', exact: true }).click();
  await page.getByRole('button', { name: 'Revoca accesso' }).click();
  await expect(page.getByText('Accesso revocato.')).toBeVisible();
  await expect(page.getByTestId('bank-connection')).toHaveCount(0);
  await page.goto('/#/transactions');
  await page.getByLabel('Periodo', { exact: true }).selectOption('last_3_months');
  await expect(page.getByTestId('tx-row')).toHaveCount(6); // i movimenti importati restano

  expect(errors).toEqual([]);
});
