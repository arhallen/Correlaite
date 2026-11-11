import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';
import { config } from '../config.js';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { deleteBlob, getBlob, putBlob } from '../storage.js';
import { fetchSeries, makeFilename, publicParams, requestSchema, alphaVantageConfigured, toTable } from '../alphavantage.js';

// Never selects blob_path or the requester: users only see what was downloaded, not where it is stored or by whom.
const LIST = `select id, function, symbol, market, params, filename, size_bytes::float8 as size_bytes, row_count, created_at,
                     coalesce(requested_by = $1, false) as mine
                from market_data`;

export default async function marketDataRoutes(app: FastifyInstance) {
  app.get('/market-data', { preHandler: requireUser }, async (req) => {
    const { rows } = await q(`${LIST} order by created_at desc limit 500`, [req.user!.id]);
    return { configured: alphaVantageConfigured(), items: rows };
  });

  app.post('/market-data', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = req.user!;
    const r = requestSchema.parse(req.body);
    if (!alphaVantageConfigured()) throw new HttpError(503, 'Alpha Vantage is not configured');

    // Alpha Vantage quotas are tiny and shared by everyone, so cap downloads per user.
    const used = (
      await q("select count(*)::int n from market_data where requested_by = $1 and created_at > now() - interval '24 hours'", [user.id])
    ).rows[0].n;
    if (used >= config.ALPHAVANTAGE_DAILY_DOWNLOAD_LIMIT) throw new HttpError(429, 'Daily download limit reached');

    const { data, rows: rowCount } = await fetchSeries(r);
    const id = crypto.randomUUID();
    const filename = makeFilename(r, new Date());
    const blobPath = `market/${id}/${filename}`;
    await putBlob(blobPath, data);
    const market = 'market' in r ? r.market : null;
    const ins = await q(
      `insert into market_data(id, function, symbol, market, params, filename, blob_path, size_bytes, row_count, requested_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [id, r.function, r.symbol, market, JSON.stringify(publicParams(r)), filename, blobPath, data.length, rowCount, user.id],
    );
    await q("insert into usage_events(user_id, kind, meta) values ($1, 'alphavantage_download', $2)", [user.id, JSON.stringify({ function: r.function })]);
    return (await q(`${LIST} where id = $2`, [user.id, ins.rows[0].id])).rows[0];
  });

  // Viewer: the stored JSON as a table (newest first, first 500 rows).
  app.get('/market-data/:id/preview', { preHandler: requireUser }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = (await q('select filename, blob_path from market_data where id = $1', [id])).rows[0];
    if (!row) throw new HttpError(404, 'Not found');
    const table = toTable(JSON.parse((await getBlob(row.blob_path)).toString('utf8')));
    if (!table) throw new HttpError(422, 'This file has no time series to show');
    return { filename: row.filename, kind: 'table', ...table };
  });

  app.get('/market-data/:id/download', { preHandler: requireUser }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = (await q('select filename, blob_path from market_data where id = $1', [id])).rows[0];
    if (!row) throw new HttpError(404, 'Not found');
    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(await getBlob(row.blob_path));
  });

  // Catalog files are shared, so only the person who downloaded one (or an admin) may remove it.
  app.delete('/market-data/:id', { preHandler: requireUser }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const user = req.user!;
    const { rows } = await q(
      'delete from market_data where id = $1 and (requested_by = $2 or $3) returning blob_path',
      [id, user.id, user.role === 'admin'],
    );
    if (!rows[0]) throw new HttpError(404, 'Not found');
    await deleteBlob(rows[0].blob_path).catch((e) => req.log.warn(e, 'blob delete failed'));
    return { ok: true };
  });
}
