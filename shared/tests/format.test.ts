import { describe, expect, it } from 'vitest';
import { formatDate, formatINR, formatINRCompact } from '../src/format';

describe('formatINR', () => {
  it('groups in Indian style with paise', () => {
    expect(formatINR('2500000')).toBe('₹25,00,000.00');
    expect(formatINR('2500000.5')).toBe('₹25,00,000.50');
    expect(formatINR('999')).toBe('₹999.00');
    expect(formatINR('1000')).toBe('₹1,000.00');
    expect(formatINR('123456789.99')).toBe('₹12,34,56,789.99');
    expect(formatINR('-100000')).toBe('-₹1,00,000.00');
  });
  it('rejects non-decimal input', () => {
    expect(() => formatINR('12abc')).toThrow();
  });
});

describe('formatINRCompact', () => {
  it('uses lakh and crore', () => {
    expect(formatINRCompact('2500000')).toBe('₹25 L');
    expect(formatINRCompact('12000000')).toBe('₹1.2 Cr');
    expect(formatINRCompact('150000.00')).toBe('₹1.5 L');
    expect(formatINRCompact('45000')).toBe('₹45,000');
  });
});

describe('formatDate', () => {
  it('formats DATE strings', () => {
    expect(formatDate('2027-03-31')).toBe('31 Mar 2027');
    expect(formatDate('2026-01-05T10:00:00Z')).toBe('5 Jan 2026');
    expect(() => formatDate('2026-13-01')).toThrow();
  });
});
