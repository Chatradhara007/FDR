import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Alert, AlertListResponse, AlertSummary, OutboxResponse } from '@fdr/shared';
import { apiFetch } from './client';

// Server state for alerts. Keys: ['alerts', params], ['alert-summary'], ['outbox', page].

export function useAlerts(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const query = qs.toString();
  return useQuery({
    queryKey: ['alerts', query],
    queryFn: () => apiFetch<AlertListResponse>(`/alerts${query ? `?${query}` : ''}`),
  });
}

/** The bell: polled every 30 s; clock changes invalidate every query, so it also refreshes after a jump. */
export function useAlertSummary() {
  return useQuery({ queryKey: ['alert-summary'], queryFn: () => apiFetch<AlertSummary>('/alerts/summary'), refetchInterval: 30_000 });
}

function useRefreshAlerts() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['alerts'] });
    void qc.invalidateQueries({ queryKey: ['alert-summary'] });
    void qc.invalidateQueries({ queryKey: ['instruments'] });
    void qc.invalidateQueries({ queryKey: ['queue'] });
  };
}

export function useAcknowledgeAlert() {
  const refresh = useRefreshAlerts();
  return useMutation({ mutationFn: (id: string) => apiFetch<Alert>(`/alerts/${id}/acknowledge`, { method: 'POST', body: {} }), onSuccess: refresh });
}

export function useResolveAlert() {
  const refresh = useRefreshAlerts();
  return useMutation({
    mutationFn: (v: { id: string; note: string }) => apiFetch<Alert>(`/alerts/${v.id}/resolve`, { method: 'POST', body: { note: v.note } }),
    onSuccess: refresh,
  });
}

export function useOutbox(page: number, pageSize = 25) {
  return useQuery({
    queryKey: ['outbox', page, pageSize],
    queryFn: () => apiFetch<OutboxResponse>(`/outbox?page=${page}&pageSize=${pageSize}`),
  });
}
