import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, AuditPage, DocumentAccessRow, EvaluationSummary, IntegrityResult, Role, RuleView } from '@fdr/shared';
import { apiDownload, apiFetch } from './client';
import { toQuery, type Params } from './reporting';

// Server state for Phase 08. Keys: ['rules'], ['users'], ['audit-events', q], ['audit-integrity'], ['document-access', q].

export function useRules() {
  return useQuery({ queryKey: ['rules'], queryFn: () => apiFetch<RuleView[]>('/rules') });
}

export function useSaveRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, config, active, version }: { key: string; config: unknown; active: boolean; version: number }) =>
      apiFetch<RuleView>(`/rules/${key}`, { method: 'PUT', body: { config, active, version } }),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useRestoreRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => apiFetch<RuleView>(`/rules/${key}/restore-default`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/** Runs the daily evaluation now (admin); every query refreshes afterwards. */
export function useEvaluateNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<EvaluationSummary>('/jobs/evaluate', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => apiFetch<AdminUser[]>('/users') });
}

export interface NewUserInput {
  name: string; email: string; role: Role; institutionId?: string; designation?: string; password: string;
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewUserInput) => apiFetch<AdminUser>('/users', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; version: number; name?: string; designation?: string | null; active?: boolean }) =>
      apiFetch<AdminUser>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiFetch<AdminUser>(`/users/${id}/reset-password`, { method: 'POST', body: { password } }),
  });
}

export function useAuditEvents(params: Params) {
  const q = toQuery(params);
  return useQuery({ queryKey: ['audit-events', q], queryFn: () => apiFetch<AuditPage>(`/audit/events${q}`) });
}

/** CSV of the matching events; the server records the export as REPORT_EXPORTED. */
export function downloadAuditEvents(params: Params): Promise<void> {
  return apiDownload(`/audit/events${toQuery({ ...params, format: 'csv', page: undefined, pageSize: undefined })}`, 'fdr-audit-log.csv');
}

export function useIntegrity() {
  return useQuery({ queryKey: ['audit-integrity'], queryFn: () => apiFetch<IntegrityResult>('/audit/integrity') });
}

export function useRecheckIntegrity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<IntegrityResult>('/audit/integrity?fresh=1'),
    onSuccess: (data) => qc.setQueryData(['audit-integrity'], data),
  });
}

export function useDocumentAccess(instrumentId: string) {
  const q = toQuery({ instrumentId });
  return useQuery({ queryKey: ['document-access', q], queryFn: () => apiFetch<DocumentAccessRow[]>(`/audit/document-access${q}`) });
}
