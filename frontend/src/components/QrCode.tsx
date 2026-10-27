import { cn } from '@/lib/cn';

/** A QR code from the server's inline SVG (generated from our own address, never from user input). */
export function QrCode({ svg, label, className }: { svg: string; label: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn('bg-white [&>svg]:block [&>svg]:h-full [&>svg]:w-full', className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
