import { clearToken, getToken } from '@/auth/token';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field issues from a 422, keyed by field name, for showing next to form inputs. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as FieldIssue[]) {
      if (d && typeof d.field === 'string' && !(d.field in out)) out[d.field] = d.message;
    }
    return out;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function send(path: string, { method = 'GET', body, signal }: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body; // browser sets the multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload, signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server', null);
  }

  if (res.ok) return res;

  let parsed: { code?: string; message?: string; details?: unknown } = {};
  try {
    parsed = await res.json();
  } catch {
    // non-JSON error body
  }
  if (res.status === 401) {
    clearToken();
    if (window.location.pathname !== '/login') window.location.assign('/login');
  }
  throw new ApiError(res.status, parsed.code ?? 'HTTP_ERROR', parsed.message ?? res.statusText, parsed.details ?? null);
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await send(path, options);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Downloads a file and hands it to the browser; filename from Content-Disposition when present. */
export async function apiDownload(path: string, fallbackName = 'download', options: RequestOptions = {}): Promise<void> {
  const res = await send(path, options);
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
