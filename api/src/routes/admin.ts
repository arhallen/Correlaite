import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../errors.js';

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/stats', async () => {
    const totals = (
      await q(`select
        (select count(*) from users)::int as users,
        (select count(*) from users where last_login_at > now() - interval '7 days')::int as active_7d,
        (select count(*) from users where created_at > now() - interval '7 days')::int as new_7d,
        (select count(*) from runs where created_at > now() - interval '24 hours')::int as runs_24h,
        (select count(*) from runs)::int as runs_total,
        (select count(*) from runs where status = 'error')::int as runs_failed,
        (select count(*) from datasets)::int as datasets,
        (select coalesce(sum(size_bytes), 0) from datasets)::float8 as storage_bytes,
        (select coalesce(sum(quantity), 0) from usage_events where kind = 'tokens' and created_at > now() - interval '7 days')::float8 as tokens_7d`)
    ).rows[0];
    const daily = (
      await q(`select to_char(d, 'YYYY-MM-DD') as day, count(r.id)::int as runs
                 from generate_series(current_date - 13, current_date, interval '1 day') d
                 left join runs r on r.created_at >= d and r.created_at < d + interval '1 day'
                group by d order by d`)
    ).rows;
    return { ...totals, daily };
  });

  app.get('/admin/users', async () => {
    const { rows } = await q(
      `select u.id, u.email, u.role, u.disabled, u.created_at, u.last_login_at,
              (select count(*) from runs r where r.user_id = u.id)::int as runs
         from users u order by u.created_at desc limit 500`,
    );
    return rows;
  });

  app.patch('/admin/users/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ disabled: z.boolean().optional(), role: z.enum(['user', 'admin']).optional() }).parse(req.body);
    if (id === req.user!.id) throw new HttpError(400, 'You cannot change your own account here');
    const { rows } = await q(
      'update users set disabled = coalesce($2, disabled), role = coalesce($3, role) where id = $1 returning id, email, role, disabled',
      [id, b.disabled ?? null, b.role ?? null],
    );
    if (!rows[0]) throw new HttpError(404, 'Not found');
    if (b.disabled) await q('delete from sessions where user_id = $1', [id]);
    await q("insert into admin_audit(admin_id, action, target_user_id, detail) values ($1, 'user_update', $2, $3)", [
      req.user!.id,
      id,
      JSON.stringify(b),
    ]);
    return rows[0];
  });

  app.get('/admin/runs', async () => {
    const { rows } = await q(
      `select r.id, u.email, r.prompt, r.status, r.duration_ms, r.created_at
         from runs r join users u on u.id = r.user_id order by r.created_at desc limit 100`,
    );
    return rows;
  });
}
