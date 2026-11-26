import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const external: string[] = [];

test('importa un estratto conto PDF su più pagine', async ({ page }) => {
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(r.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/#/accounts');
  await page.getByRole('button', { name: 'Nuovo conto' }).first().click();
  await page.getByLabel('Nome', { exact: true }).fill('Conto Fineco');
  // saldo iniziale lasciato a 0: verrà allineato al saldo finale dell'estratto
  await page.getByLabel('Data di creazione', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: 'Crea conto' }).click();
  await expect(page.getByText('Conto creato.')).toBeVisible();

  await page.goto('/#/import');
  await page.getByTestId('import-file').setInputFiles(join(process.cwd(), 'e2e', 'fixtures', 'estratto-banca.pdf'));
  await expect(page.getByText('righe lette da 2 pagine del PDF', { exact: false })).toBeVisible();
  await expect(page.getByText(/Tabella ricostruita dalle intestazioni/)).toBeVisible();
  await page.getByRole('button', { name: 'Continua con le colonne' }).click();

  const selectedText = async (label: string) => page.getByLabel(label, { exact: true }).locator('option:checked').textContent();
  expect(await selectedText('Data *')).toBe('Data Operazione');
  expect(await selectedText('Descrizione *')).toBe('Descrizione Completa');
  expect(await selectedText('Entrate / Avere')).toBe('Entrate');
  expect(await selectedText('Uscite / Dare')).toBe('Uscite');

  await page.getByRole('button', { name: 'Genera anteprima' }).click();
  await expect(page.getByTestId('import-selected')).toHaveText('12');
  await expect(page.getByTestId('import-invalid')).toHaveText('2'); // saldo iniziale e finale
  await expect(page.getByTestId('import-preview')).toContainText('Bonifico SEPA a Concessionaria Auto Anticipo acquisto auto rif. contratto 4471');
  await expect(page.getByTestId('statement-check')).toContainText("L'estratto quadra");
  await expect(page.getByTestId('use-closing')).toBeChecked();
  await page.getByTestId('import-confirm').click();
  await expect(page.getByRole('heading', { name: '12 movimenti importati' })).toBeVisible();

  await page.goto('/#/accounts');
  const bal = await page.getByTestId('account-tile').filter({ hasText: 'Conto Fineco' }).getByTestId('account-balance').textContent();
  expect((bal ?? '').replace(/\s/g, ' ')).toContain('1.067,41');

  // reimportazione: tutto riconosciuto come duplicato
  await page.goto('/#/import');
  await page.getByTestId('import-file').setInputFiles(join(process.cwd(), 'e2e', 'fixtures', 'estratto-banca.pdf'));
  await expect(page.getByText(/righe lette da 2 pagine/)).toBeVisible();
  await page.getByRole('button', { name: 'Continua con le colonne' }).click();
  await page.getByRole('button', { name: 'Genera anteprima' }).click();
  await expect(page.getByTestId('import-duplicates')).toHaveText('12');
  await expect(page.getByTestId('import-selected')).toHaveText('0');

  // un file che non è un PDF valido
  await page.getByRole('button', { name: 'Indietro' }).click();
  await page.getByRole('button', { name: 'Indietro' }).click();
  await page.getByTestId('import-file').setInputFiles({ name: 'finto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('non sono un pdf') });
  await expect(page.getByText(/non è un PDF valido/)).toBeVisible();

  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
