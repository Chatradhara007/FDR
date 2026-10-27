import type { ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

/** One-line confirmation before a shortcut key writes anything (a stray key press never reaches the audit log). */
export function ConfirmModal({ open, title, children, confirmLabel, onConfirm, onClose, pending }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; pending?: boolean;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <p className="text-ink-2">{children}</p>
    </Modal>
  );
}
