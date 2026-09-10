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
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'Din session er udløbet eller tilbagekaldt. Log ud og ind igen.' : response.status === 403 ? 'Du har ikke adgang til denne handling.' : response.status === 409 ? 'Ændringen kunne ikke gemmes. Genindlæs listen; kontrollér rolle, bruger og sidste administrator.' : 'Handlingen kunne ikke gennemføres. Prøv igen.');
  return response.json();
}
