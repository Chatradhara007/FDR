import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClockChange, ClockState } from '@fdr/shared';
import { apiFetch } from '@/api/client';

export function useClock(enabled = true) {
  return useQuery({ queryKey: ['clock'], queryFn: () => apiFetch<ClockState>('/clock'), enabled, refetchInterval: 60_000 });
}

export type ClockAction = { kind: 'advance'; days: number } | { kind: 'set'; date: string } | { kind: 'reset' };

/** Admin clock changes. The server runs the evaluation job in the same request and returns its summary.
 *  Every query is invalidated: statuses, alerts and anything date-dependent may have moved. */
export function useClockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (a: ClockAction) => {
      if (a.kind === 'advance') return apiFetch<ClockChange>('/clock/advance', { method: 'POST', body: { days: a.days } });
      if (a.kind === 'set') return apiFetch<ClockChange>('/clock/set', { method: 'POST', body: { date: a.date } });
      return apiFetch<ClockChange>('/clock/reset', { method: 'POST' });
    },
    onSuccess: ({ clock }) => {
      queryClient.setQueryData(['clock'], { mode: clock.mode, now: clock.now, today: clock.today });
      void queryClient.invalidateQueries();
    },
  });
}
