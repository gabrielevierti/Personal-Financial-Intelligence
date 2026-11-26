import { expect, test, type Page } from '@playwright/test';

async function account(page: Page, name: string) {
  await page.goto('/#/accounts');
  await page.getByRole('button', { name: 'Nuovo conto' }).first().click();
  await page.getByLabel('Nome', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Crea conto' }).click();
  await expect(page.getByText('Conto creato.').first()).toBeVisible();
}

async function movement(page: Page, acc: string, kind: 'Entrata' | 'Uscita', desc: string, amount: string) {
  await page.goto('/#/transactions');
  await page.getByRole('button', { name: 'Nuovo movimento' }).first().click();
  if (kind === 'Entrata') await page.getByRole('button', { name: 'Entrata', exact: true }).click();
  await page.getByLabel('Conto', { exact: true }).selectOption({ label: acc });
  await page.getByLabel('Descrizione', { exact: true }).fill(desc);
  await page.getByLabel('Importo', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Registra movimento' }).click();
  await expect(page.getByText('Movimento registrato.').first()).toBeVisible();
}

test('i bonifici tra i propri conti diventano trasferimenti', async ({ page }) => {
  await account(page, 'Fineco');
  await account(page, 'Trade Republic');
  await movement(page, 'Fineco', 'Uscita', 'Bonifico SEPA a Gabriele Vierti', '300');
  await movement(page, 'Trade Republic', 'Entrata', 'VIERTI GABRIELE bonifico in entrata', '300');
  await movement(page, 'Fineco', 'Uscita', 'Amazon', '19,99');
  await movement(page, 'Trade Republic', 'Entrata', 'Rimborso', '19,99');

  await page.goto('/#/transactions');
  await expect(page.getByTestId('transfer-banner')).toContainText('2 coppie');

  // con l'intestatario impostato, la coppia certa viene collegata in automatico
  await page.goto('/#/banks');
  await page.getByLabel('Intestatario dei conti', { exact: true }).fill('Gabriele Vierti');
  await page.getByRole('button', { name: 'Salva', exact: true }).first().click();
  await expect(page.getByText('Salvato. 1 trasferimenti tra i tuoi conti riconosciuti.')).toBeVisible();

  await page.goto('/#/transactions');
  await expect(page.getByTestId('transfer-banner')).toContainText('1 coppia');
  await page.getByRole('button', { name: 'Controlla' }).click();
  await expect(page.getByTestId('transfer-candidate')).toHaveCount(1);
  await expect(page.getByTestId('transfer-candidate')).toContainText('Possibile');
  await page.getByRole('button', { name: 'Non è un trasferimento' }).click();
  await expect(page.getByTestId('transfer-candidate')).toHaveCount(0);
  await page.getByRole('button', { name: 'Chiudi' }).first().click();
  await expect(page.getByTestId('transfer-banner')).toHaveCount(0);

  await page.getByLabel('Filtra per tipologia').selectOption('transfer');
  await expect(page.getByTestId('tx-row')).toHaveCount(2);

  await page.goto('/#/dashboard');
  await expect(page.getByTestId('kpi-income')).toContainText('19,99');
  await expect(page.getByTestId('kpi-expense')).toContainText('19,99');
});

test('lo stesso conto importato due volte viene segnalato e unito', async ({ page }) => {
  await account(page, 'Fineco PDF');
  await account(page, 'VIERTI GABRIELE');
  for (const [d, amt] of [
    ['Ristorante Hazama Milano', '198'],
    ['Conad Abbasanta', '14,38'],
    ['Iliad Addebito Sdd', '34,99'],
  ]) {
    await movement(page, 'Fineco PDF', 'Uscita', `${d} It Carta N. 703`, amt);
    await movement(page, 'VIERTI GABRIELE', 'Uscita', `Pagamento Visa Debit ${d.toUpperCase()}`, amt);
  }
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('kpi-expense')).toContainText('494,74');

  await page.goto('/#/accounts');
  await expect(page.getByTestId('duplicate-accounts')).toContainText('3 movimenti uguali');
  await page.getByRole('button', { name: 'Unisci i conti' }).click();
  await page.getByTestId('merge-confirm').click();
  await expect(page.getByText('Conti uniti: 0 movimenti spostati, 3 doppioni eliminati.')).toBeVisible();
  await expect(page.getByTestId('account-tile')).toHaveCount(1);
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('kpi-expense')).toContainText('247,37');
});
