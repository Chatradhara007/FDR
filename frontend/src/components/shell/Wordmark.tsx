import { Link } from 'react-router-dom';

/** Small wordmark: a ledger mark and "FDR Portal". The Hindi title appears only on the sign-in page. */
export function Wordmark({ bilingual }: { bilingual?: boolean }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 rounded-lg ${bilingual ? 'min-w-0' : 'shrink-0'}`}>
      <svg viewBox="0 0 28 28" className="size-7 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
        <rect x="3" y="3" width="22" height="22" rx="6" />
        <path d="M9 10h10M9 14h10M9 18h6" />
      </svg>
      <span className="min-w-0 leading-tight">
        {bilingual && <span lang="hi" className="block text-sm text-slate-600">सुरक्षा जमा एवं एफडीआर प्रबंधन पोर्टल</span>}
        <span className="block font-serif text-lg font-semibold text-slate-900">
          {bilingual ? 'Security Deposit & FDR Management Portal' : 'FDR Portal'}
        </span>
      </span>
    </Link>
  );
}
