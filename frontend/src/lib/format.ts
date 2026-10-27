const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' (or an ISO timestamp, date part used) → '27 Oct 2026' (display only; shared formatDate is unchanged). */
export function formatDateGov(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const month = m && MONTHS[Number(m[2]) - 1];
  if (!m || !month) return value;
  return `${m[3]} ${month} ${m[1]}`;
}
