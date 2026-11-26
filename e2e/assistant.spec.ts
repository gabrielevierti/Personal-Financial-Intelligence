import { expect, test, type Page } from '@playwright/test';

async function movement(page: Page, kind: 'Entrata' | 'Uscita', desc: string, amount: string, date: string) {
  await page.goto('/#/transactions');
  await page.getByRole('button', { name: 'Nuovo movimento' }).first().click();
  if (kind === 'Entrata') await page.getByRole('button', { name: 'Entrata', exact: true }).click();
  await page.getByLabel('Data', { exact: true }).fill(date);
  await page.getByLabel('Descrizione', { exact: true }).fill(desc);
  await page.getByLabel('Importo', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Registra movimento' }).click();
  await expect(page.getByText('Movimento registrato.').first()).toBeVisible();
}

test('assistente AI locale: previsioni, chat in streaming, categorie proposte e regole', async ({ page }) => {
  await page.goto('/#/accounts');
  await page.getByRole('button', { name: 'Nuovo conto' }).first().click();
  await page.getByLabel('Nome', { exact: true }).fill('Fineco');
  await page.getByLabel('Data di creazione', { exact: true }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Crea conto' }).click();

  const today = new Date().toISOString().slice(0, 10);
  await movement(page, 'Uscita', 'E1790596747235s0we Moo Milano It Carta N. 703', '61,62', today);
  await movement(page, 'Uscita', 'Ristorante Hazama Milano It Carta N. 703', '198', today);
  await movement(page, 'Uscita', 'Conad Abbasanta It Carta N. 703', '14,38', today);

  // regole integrate: "Conad" diventa Alimentari, "Ristorante" Ristoranti
  await page.goto('/#/transactions');
  await page.getByTestId('auto-categorize').click();
  await expect(page.getByText(/movimenti categorizzati automaticamente/)).toBeVisible();
  await expect(page.getByTestId('tx-row').filter({ hasText: 'Conad' })).toContainText('Alimentari');
  await expect(page.getByTestId('tx-row').filter({ hasText: 'Hazama' })).toContainText('Ristoranti');

  await page.goto('/#/assistant');
  await expect(page.getByTestId('forecast')).toBeVisible();
  await page.getByRole('button', { name: /Modello:/ }).click();
  await page.getByLabel('Indirizzo', { exact: true }).fill('http://127.0.0.1:11499');
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByTestId('ai-status')).toContainText('Pronto · qwen2.5:3b');

  // chat in streaming con il contesto finanziario
  await page.getByRole('button', { name: 'Dove posso risparmiare 150 € al mese?' }).click();
  await expect(page.locator('.msg-assistant')).toContainText('Ho ricevuto il contesto finanziario.');
  await expect(page.locator('.msg-assistant strong')).toHaveText('Riepilogo');
  await expect(page.locator('.msg-assistant')).not.toContainText('ragionamento');

  // categorie proposte dall'AI per l'esercente rimasto in "Altre spese"
  await expect(page.getByTestId('ai-categorize')).toContainText('1 esercenti');
  await page.getByRole('button', { name: 'Proponi categorie' }).click();
  await expect(page.getByLabel('Categoria per moo milano')).toHaveValue('exp-shopping');
  await page.getByRole('button', { name: 'Applica 1 categorie' }).click();
  await expect(page.getByText(/Categorie applicate a 1 esercenti/)).toBeVisible();

  await page.goto('/#/transactions');
  await expect(page.getByTestId('tx-row').filter({ hasText: 'Moo Milano' })).toContainText('Shopping');
  await page.getByRole('button', { name: 'Categorie' }).click();
  await page.getByRole('button', { name: /Regole \(1\)/ }).click();
  await expect(page.getByText('«moo milano» → Shopping')).toBeVisible();
});

test('tema chiaro, scuro e di sistema', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click(); // sistema → chiaro
  await page.getByTestId('theme-toggle').click(); // chiaro → scuro
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-toggle').click(); // scuro → sistema
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
