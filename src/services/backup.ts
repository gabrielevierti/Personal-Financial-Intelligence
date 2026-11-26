/**
 * Backup e ripristino completo in JSON, con versionamento del formato e controllo di integrità SHA-256.
 * Nota: il backup NON è cifrato. Va custodito come un documento riservato.
 */
import { ALL_TABLES, db, OPTIONAL_BACKUP_TABLES, SCHEMA_VERSION, type TableName } from '../database/db';
import { sha256 } from '../utils/sha256';
import { ValidationError } from './validation';

export const BACKUP_FORMAT = 'pfi-backup';
export const BACKUP_VERSION = 1;
export const APP_VERSION = '1.0.0';

export type BackupData = Record<TableName, unknown[]>;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  appVersion: string;
  schemaVersion: number;
  exportedAt: string;
  counts: Record<TableName, number>;
  checksum: string;
  data: BackupData;
}

/** Serializzazione canonica (chiavi ordinate) per un checksum stabile. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJSON(v))).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(',')}}`;
}

export function computeChecksum(data: BackupData): string {
  return sha256(canonicalJSON(data));
}

export async function createBackup(): Promise<BackupFile> {
  const data = {} as BackupData;
  const counts = {} as Record<TableName, number>;
  await db.transaction('r', db.tables, async () => {
    for (const name of ALL_TABLES) {
      const rows = await db.table(name).toArray();
      data[name] = rows;
      counts[name] = rows.length;
    }
  });
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    checksum: computeChecksum(data),
    data,
  };
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  backup?: BackupFile;
}

const REQUIRED_KEYS: Partial<Record<TableName, string[]>> = {
  accounts: ['id', 'name', 'type', 'currency', 'initialBalance'],
  transactions: ['id', 'accountId', 'date', 'amount', 'type'],
  categories: ['id', 'name', 'kind'],
  budgets: ['id', 'month', 'limit'],
  savings_goals: ['id', 'name', 'targetAmount', 'currentAmount'],
  assets: ['id', 'name', 'type', 'quantity', 'currentPrice'],
  asset_valuations: ['id', 'assetId', 'date', 'unitPrice'],
  settings: ['key'],
};

const INT_FIELDS: Partial<Record<TableName, string[]>> = {
  accounts: ['initialBalance'],
  transactions: ['amount'],
  budgets: ['limit'],
  savings_goals: ['targetAmount', 'currentAmount'],
  assets: ['purchasePrice', 'currentPrice'],
  asset_valuations: ['unitPrice'],
};

export function validateBackup(raw: unknown): BackupValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Il file non è un JSON valido.'], warnings };
  const b = raw as Partial<BackupFile>;
  if (b.format !== BACKUP_FORMAT) errors.push('Il file non è un backup PFI.');
  if (typeof b.version !== 'number') errors.push('Versione del formato mancante.');
  else if (b.version > BACKUP_VERSION) errors.push(`Backup creato con una versione più recente del formato (v${b.version}). Aggiorna l'app.`);
  if (!b.data || typeof b.data !== 'object') errors.push('Sezione dati mancante.');
  if (errors.length) return { ok: false, errors, warnings };

  const data = b.data as Partial<BackupData>;
  for (const name of ALL_TABLES) {
    const rows = data[name];
    if (rows === undefined) {
      if (OPTIONAL_BACKUP_TABLES.includes(name)) {
        (data as BackupData)[name] = [];
        continue;
      }
      errors.push(`Tabella "${name}" mancante.`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`Tabella "${name}" non valida.`);
      continue;
    }
    const keys = REQUIRED_KEYS[name] ?? ['id'];
    const ints = INT_FIELDS[name] ?? [];
    const ids = new Set<unknown>();
    rows.forEach((row, i) => {
      if (!row || typeof row !== 'object') {
        errors.push(`${name}[${i}]: record non valido.`);
        return;
      }
      const r = row as Record<string, unknown>;
      for (const k of keys) if (r[k] === undefined) errors.push(`${name}[${i}]: campo "${k}" mancante.`);
      for (const k of ints) if (r[k] !== undefined && !Number.isInteger(r[k])) errors.push(`${name}[${i}]: "${k}" deve essere un intero (centesimi).`);
      const pk = name === 'settings' ? r.key : r.id;
      if (ids.has(pk)) errors.push(`${name}: chiave duplicata ${String(pk)}.`);
      ids.add(pk);
    });
    if (errors.length > 50) {
      errors.push('Troppi errori, validazione interrotta.');
      break;
    }
  }
  if (errors.length) return { ok: false, errors, warnings };

  // integrità referenziale
  const d = data as BackupData;
  const accountIds = new Set(d.accounts.map((a) => (a as { id: string }).id));
  const assetIds = new Set(d.assets.map((a) => (a as { id: string }).id));
  const orphanTx = d.transactions.filter((t) => !accountIds.has((t as { accountId: string }).accountId)).length;
  if (orphanTx) errors.push(`${orphanTx} movimenti fanno riferimento a conti inesistenti.`);
  const orphanVal = d.asset_valuations.filter((v) => !assetIds.has((v as { assetId: string }).assetId)).length;
  if (orphanVal) warnings.push(`${orphanVal} valutazioni senza asset verranno ignorate.`);

  if (typeof b.checksum !== 'string') errors.push('Checksum mancante: impossibile verificare l’integrità.');
  else if (computeChecksum(d) !== b.checksum) errors.push('Checksum non corrispondente: il file è stato modificato o è danneggiato.');

  if (b.schemaVersion !== undefined && b.schemaVersion < SCHEMA_VERSION) warnings.push('Backup di uno schema precedente: verrà adattato automaticamente.');

  return { ok: errors.length === 0, errors, warnings, backup: errors.length ? undefined : (b as BackupFile) };
}

export function parseBackupText(text: string): BackupValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Il file non è un JSON valido.'], warnings: [] };
  }
  return validateBackup(raw);
}

/** Sostituisce completamente i dati locali con quelli del backup (operazione atomica). */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  const v = validateBackup(backup);
  if (!v.ok || !v.backup) throw new ValidationError(v.errors);
  const data = v.backup.data;
  const assetIds = new Set(data.assets.map((a) => (a as { id: string }).id));
  await db.transaction('rw', db.tables, async () => {
    for (const name of ALL_TABLES) await db.table(name).clear();
    for (const name of ALL_TABLES) {
      let rows = data[name] as Record<string, unknown>[];
      if (name === 'asset_valuations') rows = rows.filter((r) => assetIds.has(r.assetId as string));
      if (name === 'transactions') rows = rows.map((r) => ({ ...r, fingerprint: r.fingerprint ?? '' }));
      if (rows.length) await db.table(name).bulkAdd(rows);
    }
  });
}

export function backupFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `pfi-backup-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}
