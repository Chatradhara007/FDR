import { useQuery } from '@tanstack/react-query';
import type { ReleaseVerification } from '@fdr/shared';
import { apiFetch } from './client';

/** Public lookup of a release order (no sign-in needed). Order numbers contain slashes; each part is encoded. */
export function useVerifyRelease(orderNo: string) {
  return useQuery({
    queryKey: ['verify-release', orderNo],
    queryFn: () => apiFetch<ReleaseVerification>(`/verify/release/${orderNo.split('/').map(encodeURIComponent).join('/')}`),
    enabled: orderNo.length > 0,
    retry: false,
  });
}
