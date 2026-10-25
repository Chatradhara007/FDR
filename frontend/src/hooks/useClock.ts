import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClockState } from '@fdr/shared';
import { apiFetch } from '@/api/client';

export function useClock(enabled = true) {
  return useQuery({ queryKey: ['clock'], queryFn: () => apiFetch<ClockState>('/clock'), enabled, refetchInterval: 60_000 });
}

type ClockAction = { kind: 'advance'; days: number } | { kind: 'set'; date: string } | { kind: 'reset' };

/** Admin clock changes. Every query is invalidated: anything date-dependent may have moved. */
export function useClockMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (a: ClockAction) => {
      if (a.kind === 'advance') return apiFetch<ClockState>('/clock/advance', { method: 'POST', body: { days: a.days } });
      if (a.kind === 'set') return apiFetch<ClockState>('/clock/set', { method: 'POST', body: { date: a.date } });
      return apiFetch<ClockState>('/clock/reset', { method: 'POST' });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['clock'], { mode: data.mode, now: data.now, today: data.today });
      void queryClient.invalidateQueries();
    },
  });
}
