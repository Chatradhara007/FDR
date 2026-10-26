import { clearToken, getToken, setSignOutReason } from '@/auth/token';

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

  /**
   * Field issues keyed by field name, for showing next to form inputs. Reads a 422's details array,
   * the submit shape `{ fields, missingDocuments }`, and 409s that name one `field` (e.g. DUPLICATE_REFERENCE).
   */
  fieldErrors(): Record<string, string> {
    const d = this.details as { fields?: unknown; field?: unknown } | null;
    if (d && !Array.isArray(d) && typeof d.field === 'string') return { [d.field]: this.message };
    const list = Array.isArray(d) ? d : Array.isArray(d?.fields) ? d.fields : [];
    const out: Record<string, string> = {};
    for (const d of list as FieldIssue[]) {
      if (d && typeof d.field === 'string' && !(d.field in out)) out[d.field] = d.message;
    }
    return out;
  }
}

/** Missing document types from a submit 422 (`details.missingDocuments`). */
export function missingDocumentsOf(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  const d = err.details as { missingDocuments?: unknown } | null;
  return d && Array.isArray(d.missingDocuments) ? (d.missingDocuments as string[]) : [];
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
    // A valid session that ended (e.g. its user was removed by a demo reset): tell the login page why.
    if (parsed.code === 'SESSION_ENDED' && parsed.message) setSignOutReason(parsed.message);
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

/** Multipart upload with progress (fetch has no upload progress); same token and error handling as apiFetch. */
export function apiUpload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Cannot reach the server', null));
    xhr.onload = () => {
      let parsed: { code?: string; message?: string; details?: unknown } = {};
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON body
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(parsed as T);
      if (xhr.status === 401) {
        clearToken();
        window.location.assign('/login');
      }
      reject(new ApiError(xhr.status, parsed.code ?? 'HTTP_ERROR', parsed.message ?? xhr.statusText, parsed.details ?? null));
    };
    xhr.send(form);
  });
}

/** Opens an authorised file (e.g. a PDF preview) in a new tab via a blob URL. */
export async function apiOpenInTab(path: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const res = await send(path, {});
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
