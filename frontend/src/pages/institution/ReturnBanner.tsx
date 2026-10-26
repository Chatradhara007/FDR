import { Undo2 } from 'lucide-react';

/** Why the officer sent the instrument back (shown on the passport and in the wizard). */
export function ReturnBanner({ reason }: { reason: string }) {
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-warning-600/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">
      <Undo2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">Returned by the AICTE officer — action needed</p>
        <p>Reason: “{reason}”</p>
        <p>Correct the details or documents, then submit again. Values you do not change keep their trust level.</p>
      </div>
    </div>
  );
}
