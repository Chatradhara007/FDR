import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Button } from './Button';
import { FieldError } from './FieldError';
import { Modal } from './Modal';

/** A modal that asks for one mandatory text (a note, a reason) and shows the server's field error next to it. */
export function NoteModal({ open, title, label, submitLabel, intro, initial = '', onClose, onSubmit, pending, error, variant = 'primary' }: {
  open: boolean;
  title: string;
  label: string;
  submitLabel: string;
  intro?: ReactNode;
  /** Prefilled text the officer can edit. */
  initial?: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
  pending?: boolean;
  error?: unknown;
  variant?: 'primary' | 'danger';
}) {
  const [text, setText] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => { if (open) { setText(initial); setLocal(null); } }, [open, initial]);
  const serverErrors = error instanceof ApiError ? error.fieldErrors() : {};
  const message = local ?? Object.values(serverErrors)[0] ?? (error instanceof Error && !(error instanceof ApiError && error.status === 422) ? error.message : undefined);
  const submit = () => {
    if (!text.trim()) return setLocal(`${label} is required`);
    setLocal(null);
    onSubmit(text.trim());
  };
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={variant} loading={pending} onClick={submit}>{submitLabel}</Button>
        </>
      }
    >
      {intro && <div className="mb-3 text-slate-700">{intro}</div>}
      <label htmlFor="note-modal-text" className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <textarea
        id="note-modal-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        aria-invalid={!!message}
        aria-describedby={message ? 'note-modal-error' : undefined}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <FieldError id="note-modal-error" message={message} />
    </Modal>
  );
}
