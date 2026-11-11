import crypto from 'node:crypto';

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

/** Pull the first fenced code block out of an LLM answer (or return the text as-is). */
export function extractCode(text: string): string {
  const m = text.match(/```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/i);
  return (m?.[1] ?? text).trim();
}

export const ALLOWED_EXT = ['.csv', '.tsv', '.json', '.xlsx', '.parquet', '.txt'];

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}

export function hasAllowedExt(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXT.some((e) => lower.endsWith(e));
}
