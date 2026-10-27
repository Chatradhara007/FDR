/** "Good morning" / "Good afternoon" / "Good evening" for an instant, in India time (the app clock's now). */
export function greeting(nowIso: string | undefined): string {
  const hour = nowIso
    ? Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date(nowIso)))
    : 9;
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function firstName(name: string | undefined): string {
  // Skip honorifics and initials: "Dr. K. Ramakrishna Rao" → "Ramakrishna".
  const words = (name ?? '').trim().split(/\s+/);
  return words.find((w) => !/^(dr|prof|mr|mrs|ms|shri|smt|sri)\.?$/i.test(w) && !/^[A-Z]\.$/.test(w)) ?? words[0] ?? '';
}

/** "1 deposit" / "3 deposits"; "Two" … "Nine" spelt out at the start of a sentence. */
export function countWord(n: number, one: string, many: string, capital = false): string {
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const num = n < words.length && capital ? words[n] : String(n);
  return `${num} ${n === 1 ? one : many}`;
}
