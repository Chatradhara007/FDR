import { describe, expect, it } from 'vitest';
import { normAmount } from '../src/normalize';

// Same cases as backend/tests/test_normalize.py, so the UI preview agrees with the server.
describe('normAmount', () => {
  it('strips commas, rupee sign and spaces', () => {
    expect(normAmount('25,00,000')).toBe('2500000.00');
    expect(normAmount('₹25,00,000')).toBe('2500000.00');
    expect(normAmount('₹ 25,00,000.5')).toBe('2500000.50');
    expect(normAmount('Rs. 1,50,000')).toBe('150000.00');
    expect(normAmount('INR 2500000')).toBe('2500000.00');
    expect(normAmount(2500000)).toBe('2500000.00');
    expect(normAmount('0025000.10')).toBe('25000.10');
    expect(normAmount('100.')).toBe('100.00');
    expect(normAmount('100.500')).toBe('100.50');
  });

  it('rejects non-amounts and sub-paise precision', () => {
    for (const bad of ['', 'abc', '-500', '12.345', '1e6', '12,3a']) expect(() => normAmount(bad)).toThrow();
  });
});
