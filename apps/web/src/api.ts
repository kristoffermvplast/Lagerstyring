const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export async function checkApi(): Promise<boolean> {
  const response = await fetch(`${base}/api/health/live`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('API unavailable');
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
}
