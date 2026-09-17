import {requestJson} from './request-json';
import { createClient } from '@supabase/supabase-js';

const origin = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// Auth only. Business data is never read/written through the Supabase Data API.
export const authClient = origin && key ? createClient(origin, key, {
  auth: { storageKey: 'lager-auth-session', storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
}) : null;

const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export async function accessApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { data, error } = await authClient!.auth.getSession();
  if (error || !data.session) throw new Error('Din session er udløbet. Log ind igen.');
  return requestJson<T>(`${base}/api${path}`, {
    method, headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
}
