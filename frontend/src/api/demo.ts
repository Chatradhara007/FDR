import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BankCorrectionInput, BankCorrectionResult, DemoAnchor, DemoResetResult } from '@fdr/shared';
import { apiDownload, apiFetch } from './client';

// Demo tools (Phase 9, DEMO_MODE only). Keys: ['demo-anchors'].

export function useAnchors() {
  return useQuery({ queryKey: ['demo-anchors'], queryFn: () => apiFetch<DemoAnchor[]>('/demo/anchors') });
}

/** Wipes and re-seeds the demo data; every query refreshes (the clock is back at today, SIMULATED). */
export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<DemoResetResult>('/demo/reset', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useBankCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BankCorrectionInput) => apiFetch<BankCorrectionResult>('/demo/bank-correction', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useTamper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ eventId: number }>('/demo/tamper', { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['audit-integrity'] }),
  });
}

export function useUndoTamper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ restored: number[] }>('/demo/tamper/undo', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['audit-integrity'] }),
  });
}

export type SampleName = 'fdr-copy' | 'fdr-copy-different-amount' | 'bank-letter';

export function downloadSample(name: SampleName) {
  return apiDownload(`/demo/files/${name}`, `A1-${name}.pdf`);
}
