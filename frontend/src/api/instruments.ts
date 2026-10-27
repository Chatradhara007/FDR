import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DocType, InstrumentCreateInput, InstrumentDetail, InstrumentListResponse, InstrumentPatchInput, Meta, Passport, UploadResponse,
} from '@fdr/shared';
import { apiFetch, apiUpload } from './client';

// Server state for instruments (TanStack Query). Keys: ['instruments', params] lists, ['instrument', id] details,
// ['passport', id] passports.

export function useMeta(enabled = true) {
  return useQuery({ queryKey: ['meta'], queryFn: () => apiFetch<Meta>('/meta'), staleTime: 5 * 60_000, enabled });
}

export function useInstruments(params: Record<string, string | number | string[] | undefined> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item));
  }
  const query = qs.toString();
  return useQuery({
    queryKey: ['instruments', query],
    queryFn: () => apiFetch<InstrumentListResponse>(`/instruments${query ? `?${query}` : ''}`),
  });
}

export function useInstrument(id: string | undefined) {
  return useQuery({
    queryKey: ['instrument', id],
    queryFn: () => apiFetch<InstrumentDetail>(`/instruments/${id}`),
    enabled: !!id,
  });
}

export function usePassport(id: string | undefined) {
  return useQuery({
    queryKey: ['passport', id],
    queryFn: () => apiFetch<Passport>(`/instruments/${id}/passport`),
    enabled: !!id,
  });
}

/** POST /instruments/:id/renew — returns the new replacement draft. */
export function useRenew() {
  const store = useStoreDetail();
  return useMutation({
    mutationFn: (parentId: string) => apiFetch<InstrumentDetail>(`/instruments/${parentId}/renew`, { method: 'POST', body: {} }),
    onSuccess: (d) => store(d),
  });
}

/** After any write: store the fresh detail and refresh lists. */
function useStoreDetail() {
  const qc = useQueryClient();
  return (detail: InstrumentDetail | null, id?: string) => {
    if (detail) qc.setQueryData(['instrument', detail.id], detail);
    else if (id) void qc.invalidateQueries({ queryKey: ['instrument', id] });
    void qc.invalidateQueries({ queryKey: ['instruments'] });
    void qc.invalidateQueries({ queryKey: ['passport'] });
  };
}

export function useCreateInstrument() {
  const store = useStoreDetail();
  return useMutation({
    mutationFn: (body: InstrumentCreateInput) => apiFetch<InstrumentDetail>('/instruments', { method: 'POST', body }),
    onSuccess: (d) => store(d),
  });
}

export function usePatchInstrument(id: string | undefined) {
  const store = useStoreDetail();
  return useMutation({
    mutationFn: (body: InstrumentPatchInput) => apiFetch<InstrumentDetail>(`/instruments/${id}`, { method: 'PATCH', body }),
    onSuccess: (d) => store(d),
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/instruments/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: ['instrument', id] });
      void qc.invalidateQueries({ queryKey: ['instruments'] });
    },
  });
}

export function useSubmitInstrument(id: string | undefined) {
  const store = useStoreDetail();
  return useMutation({
    mutationFn: () => apiFetch<InstrumentDetail>(`/instruments/${id}/submit`, { method: 'POST' }),
    onSuccess: (d) => store(d),
  });
}

export function useUploadDocument(id: string | undefined) {
  const store = useStoreDetail();
  return useMutation({
    mutationFn: (v: { file: File; docType: DocType; onProgress?: (f: number) => void }) => {
      const form = new FormData();
      form.append('docType', v.docType);
      form.append('file', v.file);
      return apiUpload<UploadResponse>(`/instruments/${id}/documents`, form, v.onProgress);
    },
    onSuccess: () => store(null, id),
  });
}

export function useRemoveDocument(id: string | undefined) {
  const store = useStoreDetail();
  return useMutation({
    mutationFn: (docId: string) => apiFetch<void>(`/instruments/${id}/documents/${docId}`, { method: 'DELETE' }),
    onSuccess: () => store(null, id),
  });
}

export const documentPath = (instrumentId: string, docId: string, kind: 'download' | 'preview') =>
  `/instruments/${instrumentId}/documents/${docId}/${kind}`;
