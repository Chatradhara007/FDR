// Display formatting shared by frontend and backend (reports, CSV). Money stays a string:
// we never route amounts through JS floats for anything but the compact, approximate form.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Splits '-2500000.5' into sign, integer digits and 2-digit paise without float math. */
function splitAmount(amount: string | number): { negative: boolean; rupees: string; paise: string } {
  const s = String(amount).trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Not a decimal amount: ${s}`);
  const rupees = m[2].replace(/^0+(?=\d)/, '');
  const paise = ((m[3] ?? '') + '00').slice(0, 2);
  return { negative: m[1] === '-', rupees, paise };
}

/** Indian digit grouping: 2500000 → 25,00,000 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** '2500000' → '₹25,00,000.00' (paise beyond two digits are truncated, not rounded). */
export function formatINR(amount: string | number): string {
  const { negative, rupees, paise } = splitAmount(amount);
  return `${negative ? '-' : ''}₹${groupIndian(rupees)}.${paise}`;
}

function trimNumber(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(/\.?0+$/, '');
}

/** Compact Indian form: ₹25 L, ₹1.2 Cr, ₹45,000. Approximate by design (display only). */
export function formatINRCompact(amount: string | number): string {
  const { negative, rupees } = splitAmount(amount);
  const sign = negative ? '-' : '';
  const n = Number(rupees);
  if (n >= 1_00_00_000) return `${sign}₹${trimNumber(n / 1_00_00_000, 2)} Cr`;
  if (n >= 1_00_000) return `${sign}₹${trimNumber(n / 1_00_000, 2)} L`;
  return `${sign}₹${groupIndian(rupees)}`;
}

/** 'YYYY-MM-DD' (or an ISO timestamp, date part used) → '31 Mar 2027'. */
export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) throw new Error(`Not a date: ${value}`);
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) throw new Error(`Not a date: ${value}`);
  return `${Number(m[3])} ${month} ${m[1]}`;
}
