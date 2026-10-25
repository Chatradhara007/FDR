import { describe, expect, it } from 'vitest';
import { normAmount, normBool, normDate, normName, normRef } from '../src/normalize';

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

describe('normDate', () => {
  it('normalises ISO and Indian day-first formats', () => {
    expect(normDate('2027-03-31')).toBe('2027-03-31');
    expect(normDate('2027-3-1')).toBe('2027-03-01');
    expect(normDate('31/03/2027')).toBe('2027-03-31');
    expect(normDate('1-4-2027')).toBe('2027-04-01');
    expect(normDate('31.03.2027')).toBe('2027-03-31');
    expect(normDate('2027-03-31T10:00:00Z')).toBe('2027-03-31');
    expect(normDate('29/02/2028')).toBe('2028-02-29');
  });
  it('rejects impossible dates', () => {
    for (const bad of ['2027-02-29', '31/04/2027', '2027-13-01', 'March 31', '']) expect(() => normDate(bad)).toThrow();
  });
});

describe('normName', () => {
  it('uppercases, strips dots and commas, collapses spaces', () => {
    expect(normName('  Vasavi College of Engg., Hyderabad ')).toBe('VASAVI COLLEGE OF ENGG HYDERABAD');
    expect(normName('A.I.C.T.E.')).toBe('A I C T E');
    expect(normName('Member   Secretary,AICTE')).toBe('MEMBER SECRETARY AICTE');
    expect(normName('Member Secretary, AICTE')).toBe(normName('member secretary aicte'));
  });
});

describe('normRef', () => {
  it('uppercases and strips all whitespace', () => {
    expect(normRef(' sbi fd 0042 17 ')).toBe('SBIFD004217');
    expect(normRef('HDFC/FD/2026\t001')).toBe('HDFC/FD/2026001');
  });
});

describe('normBool', () => {
  it('maps common truthy/falsy forms', () => {
    expect(normBool(true)).toBe('true');
    expect(normBool('Yes')).toBe('true');
    expect(normBool('1')).toBe('true');
    expect(normBool(false)).toBe('false');
    expect(normBool('no')).toBe('false');
    expect(normBool(null)).toBe('false');
    expect(() => normBool('maybe')).toThrow();
  });
});
