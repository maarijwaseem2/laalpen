import { create } from 'zustand';
import { API_URL } from './config';

/**
 * The live API runs on free hosting (Render) that sleeps after ~15 idle minutes; the first request then
 * takes about a minute or two while it starts. We wake it as soon as the app opens (while the user is still
 * typing), show a "server is starting" note while we wait, and retry once instead of failing.
 */
export const useServer = create<{ waking: boolean }>(() => ({ waking: false }));

const AWAKE_MS = 10 * 60_000; // it stays up for 15 idle minutes; re-check after 10
const MAX_WAIT_MS = 180_000;
let lastOk = 0;
let pending: Promise<boolean> | null = null;

/** Any answer from the API proves it is awake. */
export function markServerOk() {
  lastOk = Date.now();
  if (useServer.getState().waking) useServer.setState({ waking: false });
}

/** fetch() that gives up after `ms` (React Native and browsers otherwise wait forever on a stuck connection). */
export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function ping(ms: number) {
  try {
    return (await fetchWithTimeout(`${API_URL}/api/health/live`, { method: 'GET' }, ms)).ok;
  } catch {
    return false;
  }
}

/**
 * Resolves true once the API answers (waits up to 3 minutes), false if it never does (offline).
 * `force` re-checks even if the API answered recently (used after a request failed).
 */
export function wakeServer(force = false): Promise<boolean> {
  if (!force && Date.now() - lastOk < AWAKE_MS) return Promise.resolve(true);
  if (!pending) {
    pending = (async () => {
      const slow = setTimeout(() => useServer.setState({ waking: true }), 2500);
      try {
        const deadline = Date.now() + MAX_WAIT_MS;
        while (Date.now() < deadline) {
          if (await ping(Math.max(5_000, Math.min(150_000, deadline - Date.now())))) {
            markServerOk();
            return true;
          }
          await new Promise((r) => setTimeout(r, 3_000));
        }
        return false;
      } finally {
        clearTimeout(slow);
        useServer.setState({ waking: false });
        pending = null;
      }
    })();
  }
  return pending;
}
