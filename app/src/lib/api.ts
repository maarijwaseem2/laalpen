import { API_URL } from './config';
import { useAuth } from './auth';
import type { Session } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const { refreshToken, setSession, clear } = useAuth.getState();
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.status === 401 || res.status === 403) {
        await clear(); // the session really ended
        return false;
      }
      if (!res.ok) return false; // server hiccup: keep the user logged in
      await setSession((await res.json()) as Session);
      return true;
    } catch {
      return false; // offline / timeout: keep the user logged in and try again later
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

/** Called when the server says "set up the authenticator app first" (admins). */
let onMfaSetupRequired: (() => void) | null = null;
export const setMfaSetupHandler = (fn: () => void) => { onMfaSetupRequired = fn; };

/** Called when the server wants a fresh password / authenticator check (sensitive actions). Resolves true when confirmed. */
let onStepUp: (() => Promise<boolean>) | null = null;
export const setStepUpHandler = (fn: () => Promise<boolean>) => { onStepUp = fn; };

async function peekCode(res: Response): Promise<string | undefined> {
  try {
    return (await res.clone().json())?.code;
  } catch {
    return undefined;
  }
}

async function parse(res: Response) {
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!res.ok) {
    if (res.status === 403 && body?.code === 'MFA_SETUP_REQUIRED') onMfaSetupRequired?.();
    const msg = Array.isArray(body?.message) ? body.message[0] : body?.message;
    throw new ApiError(res.status, msg || 'Something went wrong. Please try again.', body?.code);
  }
  return body;
}

export async function request<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData; auth?: boolean } = {}): Promise<T> {
  const doFetch = () => {
    const token = useAuth.getState().accessToken;
    const headers: Record<string, string> = {};
    if (init.auth !== false && token) headers.authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(`${API_URL}/api${path}`, {
      method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
      headers,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  };
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError(0, `Cannot reach the LaalPen server at ${API_URL}. Is the backend running and on the same Wi-Fi?`);
  }
  if (res.status === 401 && init.auth !== false && (await refreshSession())) res = await doFetch();
  // sensitive action: confirm it is you, then try once more
  if (res.status === 403 && onStepUp && (await peekCode(res)) === 'STEP_UP_REQUIRED' && (await onStepUp())) res = await doFetch();
  return parse(res);
}

export const api = {
  get: <T = any>(p: string) => request<T>(p),
  post: <T = any>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: body ?? {} }),
  patch: <T = any>(p: string, body: unknown) => request<T>(p, { method: 'PATCH', body }),
  del: <T = any>(p: string) => request<T>(p, { method: 'DELETE' }),
  upload: <T = any>(p: string, form: FormData) => request<T>(p, { method: 'POST', form }),
  put: <T = any>(p: string, body: unknown) => request<T>(p, { method: 'PUT', body }),
  public: <T = any>(p: string, body: unknown) => request<T>(p, { method: 'POST', body, auth: false }),
};
