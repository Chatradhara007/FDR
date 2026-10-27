/** Neutral crest-style mark (not a national emblem, not an AICTE logo): a shield with a 24-spoke wheel. */
export function Crest({ className }: { className?: string }) {
  const spokes = Array.from({ length: 24 }, (_, i) => (i * 360) / 24);
  return (
    <svg viewBox="0 0 64 72" className={className} role="img" aria-label="Portal crest">
      <path d="M32 2 L60 12 V36 C60 54 47 65 32 70 C17 65 4 54 4 36 V12 Z" fill="#fff" stroke="#0b2a5b" strokeWidth="3" />
      <path d="M32 8 L54 16 V36 C54 50 44 59 32 63 C20 59 10 50 10 36 V16 Z" fill="none" stroke="#e87722" strokeWidth="1.5" />
      <g transform="translate(32 36)" stroke="#0b2a5b" strokeWidth="1.2">
        <circle r="15" fill="none" strokeWidth="2.2" />
        <circle r="3" fill="#0b2a5b" />
        {spokes.map((a) => <line key={a} x1="0" y1="0" x2="0" y2="-15" transform={`rotate(${a})`} />)}
      </g>
      <rect x="18" y="56" width="28" height="3" fill="#138808" />
    </svg>
  );
}
