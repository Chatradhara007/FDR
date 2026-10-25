// Normalisers produce the canonical string form of tracked field values, so values typed by an
// institution, read from a document and returned by a bank compare equal. All string-based: no floats.

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

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

/** Accepts 'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY' (or an ISO timestamp) → 'YYYY-MM-DD'. */
export function normDate(input: string): string {
  const s = input.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T)/.exec(s);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
  else throw new Error(`Not a date: ${input}`);
  if (!isValidDate(y, m, d)) throw new Error(`Not a date: ${input}`);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'Vasavi College of Engg., Hyd' → 'VASAVI COLLEGE OF ENGG HYD' */
export function normName(input: string): string {
  return input.toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 'sbi fd 0042 17' → 'SBIFD004217' */
export function normRef(input: string): string {
  return input.toUpperCase().replace(/\s+/g, '');
}

/** true / 'yes' / 'Y' / '1' → 'true'; false / 'no' / 'N' / '0' / '' → 'false'. */
export function normBool(input: boolean | string | number | null | undefined): 'true' | 'false' {
  if (typeof input === 'boolean') return input ? 'true' : 'false';
  const s = String(input ?? '').trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on'].includes(s)) return 'true';
  if (['false', 'no', 'n', '0', 'off', ''].includes(s)) return 'false';
  throw new Error(`Not a boolean: ${String(input)}`);
}
