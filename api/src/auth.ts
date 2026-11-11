import type { FastifyReply, FastifyRequest } from 'fastify';
import { q } from './db.js';
import { HttpError } from './errors.js';
import { sha256 } from './util.js';

export interface SessionUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export const COOKIE = 'sid';
export const SESSION_DAYS = 30;

export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  const sid = req.cookies[COOKIE];
  if (!sid) throw new HttpError(401, 'Not signed in');
  const { rows } = await q(
    `select u.id, u.email, u.role, u.disabled
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha256(sid)],
  );
  const u = rows[0];
  if (!u || u.disabled) throw new HttpError(401, 'Not signed in');
  req.user = { id: u.id, email: u.email, role: u.role };
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (req.user!.role !== 'admin') throw new HttpError(403, 'Admins only');
}
