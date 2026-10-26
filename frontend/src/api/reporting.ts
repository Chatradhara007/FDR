import { useQuery } from '@tanstack/react-query';
import type { Dashboard, Improvement, InstitutionListResponse, InstitutionProfile, MyDay, Report } from '@fdr/shared';
import { apiDownload, apiFetch } from './client';

// Server state for Phase 07. Clock changes invalidate every query, so all of these refresh after a jump.

export type Params = Record<string, string | number | boolean | string[] | undefined | null>;

export function toQuery(params: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v)) { if (v.length) qs.set(k, v.join(',')); } else qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function useDashboard(params: Params) {
  const q = toQuery(params);
  return useQuery({ queryKey: ['dashboard', q], queryFn: () => apiFetch<Dashboard>(`/dashboard${q}`) });
}

export function useMyDay() {
  return useQuery({ queryKey: ['myday'], queryFn: () => apiFetch<MyDay>('/myday') });
}

export function useInstitutions(params: Params) {
  const q = toQuery(params);
  return useQuery({ queryKey: ['institutions', q], queryFn: () => apiFetch<InstitutionListResponse>(`/institutions${q}`) });
}

export function useInstitution(id: string | undefined) {
  return useQuery({ queryKey: ['institution', id], queryFn: () => apiFetch<InstitutionProfile>(`/institutions/${id}`), enabled: !!id });
}

export function useReport(preset: string, params: Params) {
  const q = toQuery(params);
  return useQuery({ queryKey: ['report', preset, q], queryFn: () => apiFetch<Report>(`/reports/${preset}${q}`) });
}

/** CSV download (UTF-8 with BOM); the server records REPORT_EXPORTED. */
export function downloadReport(preset: string, params: Params): Promise<void> {
  return apiDownload(`/reports/${preset}${toQuery({ ...params, format: 'csv' })}`, `fdr-${preset}.csv`);
}

export function useImprovement() {
  return useQuery({ queryKey: ['improvement'], queryFn: () => apiFetch<Improvement>('/metrics/improvement') });
}

export function downloadImprovement(): Promise<void> {
  return apiDownload('/metrics/improvement?format=csv', 'fdr-improvement.csv');
}
