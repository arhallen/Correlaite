import { DefaultAzureCredential } from '@azure/identity';
import { config } from './config.js';
import { HttpError } from './errors.js';

// Azure Container Apps dynamic sessions (Python code interpreter).
// The session pool is deployed with sessionNetworkConfiguration.status = EgressDisabled (see infra/main.bicep),
// so executed code has no internet access. Each run uses its own session identifier => no shared state.
const API_VERSION = '2024-02-02-preview';
const cred = new DefaultAzureCredential();

export const sandboxConfigured = () => Boolean(config.SANDBOX_POOL_ENDPOINT);

async function auth(): Promise<Record<string, string>> {
  const t = await cred.getToken('https://dynamicsessions.io/.default');
  return { Authorization: `Bearer ${t.token}` };
}

const url = (path: string, identifier: string) =>
  `${config.SANDBOX_POOL_ENDPOINT}/${path}?api-version=${API_VERSION}&identifier=${encodeURIComponent(identifier)}`;

export async function uploadFile(identifier: string, filename: string, data: Buffer) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)]), filename);
  const res = await fetch(url('files/upload', identifier), { method: 'POST', headers: await auth(), body: form });
  if (!res.ok) throw new HttpError(502, `Sandbox upload failed (${res.status})`);
}

export interface ExecResult {
  status: 'success' | 'error';
  stdout: string;
  stderr: string;
  result: string;
  durationMs: number;
}

export async function executeCode(identifier: string, code: string): Promise<ExecResult> {
  const started = Date.now();
  const res = await fetch(url('code/execute', identifier), {
    method: 'POST',
    headers: { ...(await auth()), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { codeInputType: 'inline', executionType: 'synchronous', code, timeoutInSeconds: 60 },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new HttpError(502, `Sandbox execution failed (${res.status})`);
  // Response shape: { properties: { status, stdout, stderr, executionResult, ... } } -- verify against the API version in use.
  const json: any = await res.json();
  const p = json.properties ?? json;
  const stderr = String(p.stderr ?? '');
  const ok = String(p.status ?? '').toLowerCase() === 'success' && !stderr.includes('Traceback');
  return {
    status: ok ? 'success' : 'error',
    stdout: String(p.stdout ?? ''),
    stderr,
    result: p.executionResult == null ? '' : typeof p.executionResult === 'string' ? p.executionResult : JSON.stringify(p.executionResult),
    durationMs: Date.now() - started,
  };
}
