import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIX = join(process.cwd(), 'e2e', 'fixtures');
const external: string[] = [];

/** Normalizza gli spazi (Intl usa spazi non separabili). */
const norm = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

async function balanceOf(page: Page, name: string) {
  const tile = page.getByTestId('account-tile').filter({ hasText: name });
  return norm(await tile.getByTestId('account-balance').textContent());
}

test.beforeEach(async ({ page }) => {
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) external.push(r.url());
  });
});

test.afterAll(() => {
  // Verifica privacy: nessuna richiesta verso host esterni durante l'intera suite.
  expect(external, `Richieste esterne: ${external.join(', ')}`).toEqual([]);
});

test('flusso completo: conti, movimenti, trasferimenti, import, budget, obiettivi, patrimonio, report, backup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inizia aggiungendo il tuo primo conto' })).toBeVisible();

  // --- Conti -------------------------------------------------------------
  await page.getByRole('button', { name: 'Crea un conto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Conto Intesa');
  await page.getByLabel('Istituto', { exact: true }).fill('Intesa Sanpaolo');
  await page.getByLabel('Saldo iniziale', { exact: true }).fill('1.000,00');
  await page.getByRole('button', { name: 'Crea conto' }).click();
  await expect(page.getByText('Conto creato.')).toBeVisible();

  await page.goto('/#/accounts');
  await page.getByRole('button', { name: 'Nuovo conto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Deposito');
  await page.getByLabel('Tipologia', { exact: true }).selectOption('deposit');
  await page.getByRole('button', { name: 'Crea conto' }).click();
  await expect(page.getByTestId('account-tile')).toHaveCount(2);
  expect(await balanceOf(page, 'Conto Intesa')).toContain('1.000,00');

  // validazione: nome mancante
  await page.getByRole('button', { name: 'Nuovo conto' }).click();
  await page.getByRole('button', { name: 'Crea conto' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'campo obbligatorio' })).toBeVisible();
  await page.getByRole('button', { name: 'Annulla' }).click();

  // modifica conto
  await page.getByRole('button', { name: 'Modifica Deposito' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Conto deposito');
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByTestId('account-tile').filter({ hasText: 'Conto deposito' })).toBeVisible();

  // --- Movimenti manuali -------------------------------------------------
  await page.goto('/#/transactions');
  await page.getByRole('button', { name: 'Nuovo movimento' }).first().click();
  await page.getByLabel('Conto', { exact: true }).selectOption({ label: 'Conto Intesa' });
  await page.getByLabel('Descrizione', { exact: true }).fill('Spesa supermercato');
  await page.getByLabel('Importo', { exact: true }).fill('45,50');
  await page.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Alimentari' });
  await page.getByRole('button', { name: 'Registra movimento' }).click();
  await expect(page.getByText('Movimento registrato.')).toBeVisible();

  await page.getByRole('button', { name: 'Nuovo movimento' }).first().click();
  await page.getByRole('button', { name: 'Entrata', exact: true }).click();
  await page.getByLabel('Conto', { exact: true }).selectOption({ label: 'Conto Intesa' });
  await page.getByLabel('Descrizione', { exact: true }).fill('Stipendio novembre');
  await page.getByLabel('Importo', { exact: true }).fill('2000');
  await page.getByRole('button', { name: 'Registra movimento' }).click();
  await expect(page.getByTestId('tx-row')).toHaveCount(2);

  // modifica movimento
  await page.getByRole('button', { name: 'Modifica Spesa supermercato' }).click();
  await page.getByLabel('Importo', { exact: true }).fill('50,00');
  await page.getByRole('button', { name: 'Salva modifiche' }).click();
  await expect(page.getByTestId('tx-row').filter({ hasText: 'Spesa supermercato' })).toContainText('50,00');

  // --- Trasferimento -----------------------------------------------------
  await page.getByRole('button', { name: 'Trasferimento' }).first().click();
  await page.getByLabel('Dal conto', { exact: true }).selectOption({ label: 'Conto Intesa (EUR)' });
  await page.getByLabel('Al conto', { exact: true }).selectOption({ label: 'Conto deposito (EUR)' });
  await page.getByLabel('Importo trasferito', { exact: true }).fill('500');
  await page.getByRole('button', { name: 'Registra trasferimento' }).click();
  await expect(page.getByText('Trasferimento registrato.')).toBeVisible();
  await expect(page.getByTestId('tx-row')).toHaveCount(4);

  await page.goto('/#/accounts');
  expect(await balanceOf(page, 'Conto Intesa')).toContain('2.450,00'); // 1000 - 50 + 2000 - 500
  expect(await balanceOf(page, 'Conto deposito')).toContain('500,00');

  // il trasferimento non è un'entrata né un'uscita
  await page.goto('/#/dashboard');
  await expect(page.getByTestId('kpi-income')).toContainText('2.000,00');
  await expect(page.getByTestId('kpi-expense')).toContainText('50,00');
  await expect(page.getByTestId('kpi-networth')).toContainText('2.950,00');
  await expect(page.getByTestId('kpi-saving-rate')).toContainText('97,5%');

  // --- Import CSV --------------------------------------------------------
  await page.goto('/#/import');
  await page.getByLabel('Conto di destinazione', { exact: true }).selectOption({ label: 'Conto Intesa (EUR)' });
  await page.getByTestId('import-file').setInputFiles(join(FIX, 'estratto-intesa.csv'));
  await expect(page.getByText(/righe lette/)).toBeVisible();
  await page.getByRole('button', { name: 'Continua con le colonne' }).click();
  await expect(page.getByLabel('Data *', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Descrizione *', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Importo (con segno)', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Genera anteprima' }).click();
  await expect(page.getByTestId('import-selected')).toHaveText('7');
  await expect(page.getByTestId('import-invalid')).toHaveText('2');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByRole('heading', { name: '7 movimenti importati' })).toBeVisible();

  // re-import dello stesso file: tutti duplicati
  await page.getByRole('button', { name: 'Importa un altro file' }).click();
  await page.getByTestId('import-file').setInputFiles(join(FIX, 'estratto-intesa.csv'));
  await expect(page.getByText(/righe lette/)).toBeVisible();
  await page.getByRole('button', { name: 'Continua con le colonne' }).click();
  await page.getByRole('button', { name: 'Genera anteprima' }).click();
  await expect(page.getByTestId('import-duplicates')).toHaveText('7');
  await expect(page.getByTestId('import-selected')).toHaveText('0');
  await expect(page.getByTestId('import-confirm')).toBeDisabled();
  await page.getByRole('button', { name: 'Indietro' }).click();
  await page.getByRole('button', { name: 'Indietro' }).click();

  // --- Import XLSX con colonne Dare/Avere ---------------------------------
  await page.getByLabel('Conto di destinazione', { exact: true }).selectOption({ label: 'Conto deposito (EUR)' });
  await page.getByTestId('import-file').setInputFiles(join(FIX, 'carta.xlsx'));
  await expect(page.getByText(/foglio "Movimenti"/)).toBeVisible();
  await page.getByRole('button', { name: 'Continua con le colonne' }).click();
  await expect(page.getByLabel('Uscite / Dare', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('Entrate / Avere', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Genera anteprima' }).click();
  await expect(page.getByTestId('import-selected')).toHaveText('3');
  await page.getByTestId('import-confirm').click();
  await expect(page.getByRole('heading', { name: '3 movimenti importati' })).toBeVisible();

  await page.goto('/#/accounts');
  // 2450 + 2450 - 86,35 - 850 - 62,10 - 3,50*2 - 12,99 = 3881,56
  expect(await balanceOf(page, 'Conto Intesa')).toContain('3.881,56');
  // 500 - 54,50 + 19,99 - 60 = 405,49
  expect(await balanceOf(page, 'Conto deposito')).toContain('405,49');

  // --- Filtri, ricerca, paginazione ---------------------------------------
  await page.goto('/#/transactions');
  await page.getByLabel('Periodo', { exact: true }).selectOption('last_3_months');
  await expect(page.getByTestId('tx-row')).toHaveCount(14);
  await page.getByLabel('Cerca nella descrizione', { exact: true }).fill('bar centrale');
  await expect(page.getByTestId('tx-row')).toHaveCount(2);
  await page.getByLabel('Cerca nella descrizione', { exact: true }).fill('');
  await page.getByLabel('Filtra per tipologia', { exact: true }).selectOption('transfer');
  await expect(page.getByTestId('tx-row')).toHaveCount(2);
  await page.getByLabel('Filtra per tipologia', { exact: true }).selectOption('all');
  await page.getByLabel('Per pagina', { exact: true }).selectOption('10');
  await expect(page.getByTestId('tx-row')).toHaveCount(10);
  await page.getByRole('button', { name: 'Pagina successiva' }).click();
  await expect(page.getByTestId('tx-row')).toHaveCount(4);

  // categoria personalizzata
  await page.getByRole('button', { name: 'Categorie' }).click();
  await page.getByRole('button', { name: 'Nuova categoria' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Animali');
  await page.getByRole('button', { name: 'Crea categoria' }).click();
  await expect(page.getByText('Categoria creata.')).toBeVisible();
  await page.keyboard.press('Escape');

  // eliminazione di un trasferimento: rimuove entrambe le gambe
  await page.getByLabel('Per pagina', { exact: true }).selectOption('50');
  await page.getByLabel('Filtra per tipologia', { exact: true }).selectOption('transfer');
  await page.getByTestId('tx-row').first().getByRole('button', { name: /^Elimina/ }).click();
  await page.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(page.getByText('Nessun movimento corrisponde ai filtri')).toBeVisible();
  await page.getByLabel('Filtra per tipologia', { exact: true }).selectOption('all');
  await expect(page.getByTestId('tx-row')).toHaveCount(12);

  // --- Budget -------------------------------------------------------------
  await page.goto('/#/budgets');
  await page.getByRole('button', { name: 'Mese precedente' }).click(); // ottobre 2026
  await page.getByRole('button', { name: 'Crea un budget' }).click();
  await page.getByLabel('Ambito', { exact: true }).selectOption({ label: 'Casa' });
  await page.getByLabel('Limite mensile', { exact: true }).fill('900');
  await page.getByRole('button', { name: 'Crea budget' }).click();
  await expect(page.getByTestId('budget-alerts')).toContainText('raggiunto il 90%');
  await page.getByRole('button', { name: 'Nuovo budget' }).click();
  await page.getByLabel('Ambito', { exact: true }).selectOption({ label: 'Bollette' });
  await page.getByLabel('Limite mensile', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Crea budget' }).click();
  await expect(page.getByTestId('budget-alerts')).toContainText('budget superato');
  await expect(page.getByTestId('budget-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Mese successivo' }).click();
  await page.getByRole('button', { name: 'Copia dal mese precedente' }).click();
  await expect(page.getByTestId('budget-row')).toHaveCount(2);

  // --- Obiettivi -----------------------------------------------------------
  await page.goto('/#/goals');
  await page.getByRole('button', { name: 'Crea un obiettivo' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Fondo emergenza');
  await page.getByLabel('Importo desiderato', { exact: true }).fill('6000');
  await page.getByLabel('Importo già accumulato', { exact: true }).fill('1500');
  await page.getByLabel('Data obiettivo', { exact: true }).fill('2027-11-25');
  await page.getByRole('button', { name: 'Crea obiettivo' }).click();
  await expect(page.getByTestId('goal-progress')).toHaveText('25%');
  await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  await page.getByLabel('Importo', { exact: true }).fill('1500');
  await page.getByRole('button', { name: 'Aggiungi importo' }).click();
  await expect(page.getByTestId('goal-progress')).toHaveText('50%');

  // --- Patrimonio -----------------------------------------------------------
  await page.goto('/#/investments');
  await page.getByRole('button', { name: 'Aggiungi un asset' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('VWCE');
  await page.getByLabel('Quantità', { exact: true }).fill('10');
  await page.getByLabel('Prezzo medio di acquisto (unitario)', { exact: true }).fill('100');
  await page.getByLabel('Valore corrente (unitario)', { exact: true }).fill('120');
  await page.getByRole('button', { name: 'Aggiungi asset' }).click();
  await expect(page.getByTestId('assets-value')).toContainText('1.200,00');
  await expect(page.getByTestId('assets-pnl')).toContainText('+200,00');
  await page.getByRole('button', { name: 'Aggiorna valore VWCE' }).click();
  await page.getByLabel('Valore unitario', { exact: true }).fill('90');
  await page.getByRole('button', { name: 'Aggiorna valore', exact: true }).click();
  await expect(page.getByTestId('assets-pnl')).toContainText('-100,00');

  await page.goto('/#/dashboard');
  await expect(page.getByTestId('kpi-investments')).toContainText('900,00');
  await expect(page.getByTestId('chart-allocation')).toBeVisible();

  // --- Report ed esportazioni ----------------------------------------------
  await page.goto('/#/reports');
  await page.getByLabel('Mese', { exact: true }).fill('2026-10');
  await expect(page.getByTestId('report-summary')).toContainText('2.469,99'); // stipendio + rimborso Amazon
  for (const [name, ext] of [
    ['CSV', 'csv'],
    ['JSON', 'json'],
    ['Esporta PDF', 'pdf'],
  ] as const) {
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const d = await dl;
    expect(d.suggestedFilename()).toBe(`pfi-report-2026-10-01_2026-10-31.${ext}`);
    const content = readFileSync((await d.path())!);
    if (ext === 'pdf') expect(content.subarray(0, 5).toString()).toBe('%PDF-');
    if (ext === 'json') expect(JSON.parse(content.toString()).summary.income).toBe(246999);
  }

  // --- Backup, cancellazione, ripristino ----------------------------------
  await page.goto('/#/backup');
  const dl = page.waitForEvent('download');
  await page.getByTestId('backup-export').click();
  const backupPath = (await (await dl).path())!;
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  expect(backup.format).toBe('pfi-backup');
  expect(backup.counts.transactions).toBe(12);

  await page.getByTestId('wipe-start').click();
  await page.getByRole('button', { name: 'Continua' }).click();
  const finalBtn = page.getByRole('button', { name: 'Elimina definitivamente' });
  await expect(finalBtn).toBeDisabled();
  await page.getByLabel(/Digita/).fill('ELIMINA');
  await finalBtn.click();
  await expect(page.getByText('Tutti i dati sono stati eliminati.')).toBeVisible();
  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { name: 'Inizia aggiungendo il tuo primo conto' })).toBeVisible();

  // backup manomesso viene rifiutato
  await page.goto('/#/backup');
  const tampered = { ...backup, data: { ...backup.data, transactions: backup.data.transactions.slice(1) } };
  await page.getByTestId('backup-file').setInputFiles({ name: 'manomesso.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered)) });
  await expect(page.getByText(/Checksum non corrispondente/)).toBeVisible();
  await expect(page.getByTestId('restore-confirm')).toBeDisabled();
  await page.getByRole('button', { name: 'Annulla' }).click();

  await page.getByTestId('backup-file').setInputFiles(backupPath);
  await expect(page.getByText('Verificata (SHA-256)')).toBeVisible();
  await page.getByTestId('restore-confirm').click();
  await expect(page.getByText('Backup ripristinato.')).toBeVisible();
  await page.goto('/#/accounts');
  expect(await balanceOf(page, 'Conto Intesa')).toContain('4.381,56'); // il trasferimento da 500 € era stato eliminato
  await page.goto('/#/goals');
  await expect(page.getByTestId('goal-progress')).toHaveText('50%');

  // --- Eliminazione conto ---------------------------------------------------
  await page.goto('/#/accounts');
  await page.getByRole('button', { name: 'Elimina Conto deposito' }).click();
  await page.getByRole('button', { name: 'Elimina conto', exact: true }).click();
  await expect(page.getByTestId('account-tile')).toHaveCount(1);
});

test('pagina inesistente e persistenza dopo il ricaricamento', async ({ page }) => {
  await page.goto('/#/nonesiste');
  await expect(page.getByRole('heading', { name: 'Questa pagina non esiste' })).toBeVisible();
  await page.goto('/#/accounts');
  await page.getByRole('button', { name: 'Nuovo conto' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Contanti');
  await page.getByLabel('Tipologia', { exact: true }).selectOption('cash');
  await page.getByLabel('Saldo iniziale', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Crea conto' }).click();
  await expect(page.getByText('Conto creato.')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('account-tile')).toHaveCount(1);
  expect(await balanceOf(page, 'Contanti')).toContain('80,00');
});
