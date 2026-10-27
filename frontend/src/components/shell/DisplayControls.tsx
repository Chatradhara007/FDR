import { Contrast } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDisplayPrefs, type TextSize } from './prefs';

const SIZES: { key: TextSize; label: string; name: string }[] = [
  { key: 'sm', label: 'A-', name: 'Decrease text size' },
  { key: 'md', label: 'A', name: 'Default text size' },
  { key: 'lg', label: 'A+', name: 'Increase text size' },
];

/** Text size (A- A A+) and high contrast; used in the user menu and the public header. */
export function DisplayControls({ className }: { className?: string }) {
  const { size, setSize, contrast, setContrast } = useDisplayPrefs();
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div role="group" aria-label="Text size" className="inline-flex rounded-lg border border-[#d6d0c4] p-0.5">
        {SIZES.map((s) => (
          <button key={s.key} type="button" aria-label={s.name} aria-pressed={size === s.key} onClick={() => setSize(s.key)}
            className={cn('h-8 min-w-9 rounded-md px-2 text-sm font-medium', size === s.key ? 'bg-ink text-white' : 'text-ink hover:bg-strip')}>
            {s.label}
          </button>
        ))}
      </div>
      <button type="button" aria-pressed={contrast} onClick={() => setContrast(!contrast)}
        className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium', contrast ? 'border-black bg-black text-white' : 'border-[#d6d0c4] text-ink hover:bg-strip')}>
        <Contrast className="size-4" aria-hidden /> High contrast
      </button>
    </div>
  );
}
