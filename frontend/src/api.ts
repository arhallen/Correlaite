export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'correlaite', ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any).error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface User { id: string; email: string; role: 'user' | 'admin' }
export interface Dataset { id: string; filename: string; size_bytes: number; created_at: string }
export interface Run {
  id: string; dataset_id: string | null; prompt: string; code: string | null;
  status: 'running' | 'success' | 'error'; stdout: string | null; stderr: string | null;
  result: string | null; duration_ms: number | null; created_at: string;
}
export interface Stats {
  users: number; active_7d: number; new_7d: number; runs_24h: number; runs_total: number; runs_failed: number;
  datasets: number; storage_bytes: number; tokens_7d: number; daily: { day: string; runs: number }[];
}
export interface AdminUser {
  id: string; email: string; role: 'user' | 'admin'; disabled: boolean; created_at: string;
  last_login_at: string | null; runs: number;
}
export interface AdminRun { id: string; email: string; prompt: string; status: string; duration_ms: number | null; created_at: string }
