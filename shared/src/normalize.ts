// UI-side amount normaliser for the live "amount in words" preview. The authoritative normalisers
// (and every server-side check) live in the Python backend: backend/app/domain/normalize.py.

/** '₹ 25,00,000' → '2500000.00'. Throws on anything that is not a non-negative decimal amount. */
export function normAmount(input: string | number): string {
  const s = String(input).replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Not an amount: ${String(input)}`);
  const rupees = m[1].replace(/^0+(?=\d)/, '');
  const frac = m[2] ?? '';
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) throw new Error(`Amount has more than 2 decimals: ${String(input)}`);
  return `${rupees}.${(frac + '00').slice(0, 2)}`;
}
