// Banks offered in the submission form and known to the mock bank.
export const BANKS = [
  'State Bank of India',
  'Punjab National Bank',
  'Bank of Baroda',
  'Canara Bank',
  'Union Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Bank of India',
  'Indian Overseas Bank',
  'Kotak Mahindra Bank',
] as const;
export type Bank = (typeof BANKS)[number];
