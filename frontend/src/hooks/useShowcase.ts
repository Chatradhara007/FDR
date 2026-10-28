import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/api/client';

/** SHOWCASE_MODE on the server: the preloaded product build, with no demo chrome. Read from the public /health
 *  endpoint so the sign-in page knows it too. False until the answer arrives (and when the API is down). */
export function useShowcase(): boolean {
  return useShowcaseState().showcase;
}

/** `known` turns true once the server has answered (or failed), e.g. to hold back a demo-only request. */
export function useShowcaseState(): { showcase: boolean; known: boolean } {
  const q = useQuery({
    queryKey: ['showcase'],
    queryFn: () => apiFetch<{ showcaseMode?: boolean }>('/health'),
    staleTime: Infinity,
    retry: false,
  });
  return { showcase: q.data?.showcaseMode === true, known: !q.isPending };
}
