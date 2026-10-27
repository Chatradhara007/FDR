import { useEffect, useState } from 'react';

export type TextSize = 'sm' | 'md' | 'lg';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode: the setting lasts for this page only */ }
}

/** Text size (A- A A+) and high contrast, kept per browser and applied as attributes on <html>. */
export function useDisplayPrefs() {
  const [size, setSize] = useState<TextSize>(() => (read('fdr.textSize') as TextSize | null) ?? 'md');
  const [contrast, setContrast] = useState(() => read('fdr.contrast') === 'high');
  useEffect(() => {
    document.documentElement.dataset.textSize = size;
    write('fdr.textSize', size);
  }, [size]);
  useEffect(() => {
    if (contrast) document.documentElement.dataset.contrast = 'high';
    else delete document.documentElement.dataset.contrast;
    write('fdr.contrast', contrast ? 'high' : 'normal');
  }, [contrast]);
  return { size, setSize, contrast, setContrast };
}
