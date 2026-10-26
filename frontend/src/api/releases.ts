import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DecideInput, DocType, ReleaseListResponse, ReleaseView, UploadResponse } from '@fdr/shared';
import { apiFetch, apiUpload } from './client';

// Server state for release requests. Keys: ['releases', params] lists, ['release', id] one request. Every write returns
// the fresh request view; it also refreshes the passport, instrument lists and alerts it can change.

export function useReleaseRequests(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) qs.set(k, String(v));
  const query = qs.toString();
  return useQuery({
    queryKey: ['releases', query],
    queryFn: () => apiFetch<ReleaseListResponse>(`/release-requests${query ? `?${query}` : ''}`),
  });
}

export function useReleaseRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['release', id],
    queryFn: () => apiFetch<ReleaseView>(`/release-requests/${id}`),
    enabled: !!id,
  });
}

function useStoreRelease() {
  const qc = useQueryClient();
  return (view: ReleaseView | null, id?: string) => {
    if (view) qc.setQueryData(['release', view.request.id], view);
    else if (id) void qc.invalidateQueries({ queryKey: ['release', id] });
    for (const key of ['releases', 'passport', 'instruments', 'instrument', 'review', 'queue', 'alerts', 'alert-summary']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

const post = <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body: body ?? {} });

export function useCreateRelease() {
  const store = useStoreRelease();
  return useMutation({
    mutationFn: (v: { instrumentId: string; reason: string }) =>
      post<ReleaseView>(`/instruments/${v.instrumentId}/release-requests`, { reason: v.reason }),
    onSuccess: (view) => store(view),
  });
}

export function useUploadReleaseDocument() {
  const store = useStoreRelease();
  return useMutation({
    mutationFn: (v: { requestId: string; file: File; docType: DocType; onProgress?: (f: number) => void }) => {
      const form = new FormData();
      form.append('docType', v.docType);
      form.append('file', v.file);
      return apiUpload<UploadResponse>(`/release-requests/${v.requestId}/documents`, form, v.onProgress);
    },
    onSuccess: (_r, v) => store(null, v.requestId),
  });
}

export function useUpdateCondition(requestId: string) {
  const store = useStoreRelease();
  return useMutation({
    mutationFn: (v: { id: string; met: boolean; remarks?: string }) =>
      apiFetch<ReleaseView>(`/release-conditions/${v.id}`, { method: 'PATCH', body: { met: v.met, remarks: v.remarks } }),
    onSuccess: (view) => store(view),
    onError: () => store(null, requestId),
  });
}

export function useRecommend(requestId: string) {
  const store = useStoreRelease();
  return useMutation({
    mutationFn: (v: { remarks: string; level: number }) => post<ReleaseView>(`/release-requests/${requestId}/recommend`, v),
    onSuccess: (view) => store(view),
    // A 409 (blocked, or someone acted first) means the screen is out of date: reload it.
    onError: () => store(null, requestId),
  });
}

export function useDecide(requestId: string) {
  const store = useStoreRelease();
  return useMutation({
    mutationFn: (body: DecideInput) => post<ReleaseView>(`/release-requests/${requestId}/decide`, body),
    onSuccess: (view) => store(view),
    onError: () => store(null, requestId),
  });
}

export function useResubmitRelease(requestId: string) {
  const store = useStoreRelease();
  return useMutation({
    mutationFn: (note: string) => post<ReleaseView>(`/release-requests/${requestId}/resubmit`, { note }),
    onSuccess: (view) => store(view),
  });
}

export function useCancelRelease(requestId: string) {
  const store = useStoreRelease();
  return useMutation({
    mutationFn: () => post<ReleaseView>(`/release-requests/${requestId}/cancel`),
    onSuccess: (view) => store(view),
  });
}
