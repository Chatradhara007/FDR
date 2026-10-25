// Display formatting for the UI. Money stays a string: we never route amounts through JS floats for
// anything but the compact, approximate form.

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

/** ISO timestamp → '1 Nov 2026, 10:00 am' in Asia/Kolkata (the business time zone). */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0–99 in words: 25 → 'twenty-five'. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

/** 0–999 in words. */
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
}

/** Indian units on an integer digit string (crore can itself exceed 99, e.g. 'one hundred crore'). */
function rupeesInWords(digits: string): string {
  const n = BigInt(digits);
  if (n === 0n) return 'zero';
  const crore = n / 10_000_000n;
  const lakh = Number((n / 100_000n) % 100n);
  const thousand = Number((n / 1000n) % 100n);
  const rest = Number(n % 1000n);
  return [
    crore ? `${rupeesInWords(crore.toString())} crore` : '',
    lakh ? `${twoDigits(lakh)} lakh` : '',
    thousand ? `${twoDigits(thousand)} thousand` : '',
    rest ? threeDigits(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** '2500000.00' → 'Twenty-five lakh rupees'; '1500.50' → 'One thousand five hundred rupees and fifty paise'. */
export function amountInWords(amount: string | number): string {
  const { negative, rupees, paise } = splitAmount(amount);
  const p = Number(paise);
  let words = `${rupeesInWords(rupees)} ${rupees === '1' ? 'rupee' : 'rupees'}`;
  if (p) words += ` and ${twoDigits(p)} paise`;
  if (negative) words = `minus ${words}`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
