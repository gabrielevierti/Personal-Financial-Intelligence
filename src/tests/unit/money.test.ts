import { describe, expect, it } from 'vitest';
import { centsToInput, formatMoney, multiplyCents, parseAmount, sumCents, toCents } from '../../utils/money';

describe('toCents', () => {
  it('evita errori floating point', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(-12.345)).toBe(-1235);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(-0)).toBe(0);
  });
  it('somma interi senza perdita', () => {
    expect(sumCents(Array(1000).fill(10))).toBe(10000);
  });
});

describe('parseAmount', () => {
  it.each([
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['-12,50', -1250],
    ['12,50-', -1250],
    ['(12.50)', -1250],
    ['€ 1 234,56', 123456],
    ['+5', 500],
    ["1'234.50", 123450],
    ['1.234', 123400],
    ['0.5', 50],
    ['12.5', 1250],
    ['1.234.567,8', 123456780],
    ['1,234,567', 123456700],
    ['-0,01', -1],
    ['EUR -45,00', -4500],
    [42.1, 4210],
  ])('%s → %d', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
  it('importi interi con separatore forzato (regressione: "850" letto come 8,50)', () => {
    expect(parseAmount('850', '.')).toBe(85000);
    expect(parseAmount('1500', ',')).toBe(150000);
    expect(parseAmount('-3', '.')).toBe(-300);
    expect(parseAmount('1,500', '.')).toBe(150000);
  });
  it('rispetta il separatore forzato', () => {
    expect(parseAmount('1.234', '.')).toBe(123);
    expect(parseAmount('1,5', ',')).toBe(150);
    expect(parseAmount('1.234,5', ',')).toBe(123450);
  });
  it('rifiuta input non validi', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('12,3,4', ',')).toBe(12340); // separatori extra trattati come migliaia
    expect(parseAmount('12a')).toBeNull();
    expect(parseAmount('--')).toBeNull();
    expect(parseAmount(Number.NaN)).toBeNull();
  });
});

describe('formattazione', () => {
  it('formatta in euro italiano', () => {
    expect(formatMoney(123456, 'EUR').replace(/\s/g, ' ')).toMatch(/1\.234,56/);
    expect(formatMoney(500, 'EUR', { sign: true }).startsWith('+')).toBe(true);
  });
  it('centsToInput', () => {
    expect(centsToInput(123456)).toBe('1234,56');
    expect(centsToInput(-5)).toBe('-0,05');
  });
  it('multiplyCents arrotonda', () => {
    expect(multiplyCents(3333, 0.5)).toBe(1667);
    expect(multiplyCents(10000, 1.23456789)).toBe(12346);
  });
});
