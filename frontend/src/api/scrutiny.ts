import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentCheckResponse, ObservationInput, QueueResponse, ReviewPayload, TrackedField, VerifyResponse } from '@fdr/shared';
import { apiFetch } from './client';

// Server state for officer scrutiny. Keys: ['queue', params], ['review', id]; writes also refresh instrument views.

export function useQueue(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const query = qs.toString();
  return useQuery({
    queryKey: ['queue', query],
    queryFn: () => apiFetch<QueueResponse>(`/scrutiny/queue${query ? `?${query}` : ''}`),
  });
}

export function useReview(id: string | undefined) {
  return useQuery({
    queryKey: ['review', id],
    queryFn: () => apiFetch<ReviewPayload>(`/instruments/${id}/review`),
    enabled: !!id,
  });
}

/** Every scrutiny write returns the fresh review payload. */
function useStoreReview() {
  const qc = useQueryClient();
  return (review: ReviewPayload) => {
    qc.setQueryData(['review', review.instrument.id], review);
    qc.setQueryData(['instrument', review.instrument.id], review.instrument);
    void qc.invalidateQueries({ queryKey: ['queue'] });
    void qc.invalidateQueries({ queryKey: ['instruments'] });
  };
}

const post = <T,>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body: body ?? {} });

export function useClaim() {
  const store = useStoreReview();
  return useMutation({ mutationFn: (id: string) => post<ReviewPayload>(`/instruments/${id}/claim`), onSuccess: store });
}

export function useVerify(id: string) {
  const store = useStoreReview();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<VerifyResponse>(`/instruments/${id}/verify`),
    onSuccess: (r) => store(r.review),
    // A 409 (instrument changed during verification) still stored a STALE attempt: refresh the page.
    onError: () => void qc.invalidateQueries({ queryKey: ['review', id] }),
  });
}

export function useCheckDocument(id: string) {
  const store = useStoreReview();
  return useMutation({
    mutationFn: (v: { field: TrackedField; documentId: string }) =>
      post<DocumentCheckResponse>(`/instruments/${id}/fields/${v.field}/check-document`, { documentId: v.documentId }),
    onSuccess: (r) => store(r.review),
  });
}

export function useAddObservation(id: string) {
  const store = useStoreReview();
  return useMutation({ mutationFn: (body: ObservationInput) => post<ReviewPayload>(`/instruments/${id}/observations`, body), onSuccess: store });
}

export function useResolveObservation() {
  const store = useStoreReview();
  return useMutation({
    mutationFn: (v: { id: string; note: string }) => post<ReviewPayload>(`/observations/${v.id}/resolve`, { note: v.note }),
    onSuccess: store,
  });
}

export function useResolveDiscrepancy() {
  const store = useStoreReview();
  return useMutation({
    mutationFn: (v: { id: string; note: string }) => post<ReviewPayload>(`/discrepancies/${v.id}/resolve`, { note: v.note }),
    onSuccess: store,
  });
}

export function useReturnInstrument(id: string) {
  const store = useStoreReview();
  return useMutation({ mutationFn: (reason: string) => post<ReviewPayload>(`/instruments/${id}/return`, { reason }), onSuccess: store });
}

export function useAccept(id: string) {
  const store = useStoreReview();
  return useMutation({
    mutationFn: (overrideNote?: string) => post<ReviewPayload>(`/instruments/${id}/accept`, overrideNote ? { overrideNote } : {}),
    onSuccess: store,
  });
}
