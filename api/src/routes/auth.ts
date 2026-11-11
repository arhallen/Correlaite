import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';
import { adminEmails, config, isProd } from '../config.js';
import { COOKIE, SESSION_DAYS, requireUser } from '../auth.js';
import { sendMagicLink } from '../email.js';
import { HttpError } from '../errors.js';
import { newToken, sha256 } from '../util.js';

const requestBody = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const verifyBody = z.object({ token: z.string().min(20).max(200) });

export default async function authRoutes(app: FastifyInstance) {
  // Always answers 202 so the endpoint cannot be used to discover which emails have accounts.
  app.post('/auth/request', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { email } = requestBody.parse(req.body);
    const user = (await q('select disabled from users where email = $1', [email])).rows[0];
    const allowed = user ? !user.disabled : config.ALLOW_SIGNUP === 'true' || adminEmails.has(email);
    const recent = (
      await q("select count(*)::int n from login_tokens where email = $1 and created_at > now() - interval '10 minutes'", [email])
    ).rows[0].n;
    if (allowed && recent < 3) {
      const token = newToken();
      await q("insert into login_tokens(email, token_hash, expires_at) values ($1, $2, now() + interval '15 minutes')", [
        email,
        sha256(token),
      ]);
      sendMagicLink(email, token).catch((e) => req.log.error(e, 'failed to send magic link'));
    }
    return reply.code(202).send({ ok: true });
  });

  // The emailed link opens a page in the SPA which POSTs the token here, so link scanners that
  // prefetch URLs in emails cannot burn the single-use token.
  app.post('/auth/verify', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { token } = verifyBody.parse(req.body);
    const used = await q(
      'update login_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning email',
      [sha256(token)],
    );
    const email: string | undefined = used.rows[0]?.email;
    if (!email) throw new HttpError(400, 'This link is invalid or has expired');

    const isAdmin = adminEmails.has(email);
    const user = (
      await q(
        `insert into users(email, role, last_login_at) values ($1, $2, now())
         on conflict (email) do update
           set last_login_at = now(), role = case when $3 then 'admin' else users.role end
         returning id, email, role, disabled`,
        [email, isAdmin ? 'admin' : 'user', isAdmin],
      )
    ).rows[0];
    if (user.disabled) throw new HttpError(403, 'This account is disabled');

    const sid = newToken();
    await q("insert into sessions(user_id, token_hash, expires_at, user_agent) values ($1, $2, now() + ($3::text || ' days')::interval, $4)", [
      user.id,
      sha256(sid),
      String(SESSION_DAYS),
      String(req.headers['user-agent'] ?? '').slice(0, 300),
    ]);
    reply.setCookie(COOKIE, sid, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DAYS * 24 * 3600,
    });
    return { id: user.id, email: user.email, role: user.role };
  });

  app.post('/auth/logout', async (req, reply) => {
    const sid = req.cookies[COOKIE];
    if (sid) await q('delete from sessions where token_hash = $1', [sha256(sid)]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/me', { preHandler: requireUser }, async (req) => req.user);
}
