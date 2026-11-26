import { describe, expect, it } from 'vitest';
import { addMonths, detectDateFormat, excelSerialToISO, monthEnd, monthsBetween, parseDate, previousPeriod, resolvePeriod } from '../../utils/date';

describe('parseDate', () => {
  it.each([
    ['15/01/2024', '2024-01-15'],
    ['15-01-24', '2024-01-15'],
    ['15.01.2024', '2024-01-15'],
    ['2024-01-15', '2024-01-15'],
    ['2024/1/5', '2024-01-05'],
    ['2024-01-15T10:30:00Z', '2024-01-15'],
    ['20240115', '2024-01-15'],
    ['12 gen 2024', '2024-01-12'],
    ['3-mag-2023', '2023-05-03'],
    ['01/13/2024', '2024-01-13'],
    ['45306', '2024-01-15'],
  ])('%s → %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });
  it('gestisce il formato MDY esplicito', () => {
    expect(parseDate('02/03/2024', 'MDY')).toBe('2024-02-03');
    expect(parseDate('02/03/2024', 'DMY')).toBe('2024-03-02');
  });
  it('rifiuta date impossibili', () => {
    expect(parseDate('31/02/2024')).toBeNull();
    expect(parseDate('hello')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('2024-13-01')).toBeNull();
  });
  it('seriale Excel e Date', () => {
    expect(excelSerialToISO(45306)).toBe('2024-01-15');
    expect(parseDate(new Date(2024, 0, 15))).toBe('2024-01-15');
  });
  it('rileva il formato', () => {
    expect(detectDateFormat(['01/13/2024', '02/20/2024'])).toBe('MDY');
    expect(detectDateFormat(['13/01/2024', '02/03/2024'])).toBe('DMY');
  });
});

describe('periodi', () => {
  it('mesi', () => {
    expect(addMonths('2024-01', -1)).toBe('2023-12');
    expect(addMonths('2024-11', 3)).toBe('2025-02');
    expect(monthEnd('2024-02')).toBe('2024-02-29');
    expect(monthsBetween('2024-11-15', '2025-02-01')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });
  it('preset', () => {
    expect(resolvePeriod('this_month', '2024-05-10')).toMatchObject({ start: '2024-05-01', end: '2024-05-31' });
    expect(resolvePeriod('last_month', '2024-01-10')).toMatchObject({ start: '2023-12-01', end: '2023-12-31' });
    expect(resolvePeriod('this_quarter', '2024-05-10')).toMatchObject({ start: '2024-04-01', end: '2024-06-30' });
    expect(resolvePeriod('last_12_months', '2024-05-10')).toMatchObject({ start: '2023-06-01', end: '2024-05-31' });
  });
  it('periodo precedente', () => {
    expect(previousPeriod({ start: '2024-04-01', end: '2024-06-30', label: '' })).toMatchObject({ start: '2024-01-01', end: '2024-03-31' });
    expect(previousPeriod({ start: '2024-01-10', end: '2024-01-19', label: '' })).toMatchObject({ start: '2023-12-31', end: '2024-01-09' });
  });
});
