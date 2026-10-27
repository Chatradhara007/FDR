import { Undo2 } from 'lucide-react';

/** Why the officer sent the instrument back (shown on the passport and in the wizard). */
export function ReturnBanner({ reason }: { reason: string }) {
  return (
    <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl bg-warning-50 px-5 py-4 text-slate-800">
      <Undo2 className="mt-1 size-4 shrink-0 text-warning-700" aria-hidden />
      <div>
        <p className="font-medium">Returned by the AICTE officer — action needed</p>
        <p>Reason: “{reason}”</p>
        <p>Correct the details or documents, then submit again. Values you do not change keep their trust level.</p>
      </div>
    </div>
  );
}
