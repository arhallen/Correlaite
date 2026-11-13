import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';
import { config } from '../config.js';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { deleteBlob, getBlob, putBlob } from '../storage.js';
import { grantCredits, spendCredits } from '../credits.js';
import { PRICING } from '../pricing.js';
import { fetchSeries, makeFilename, publicParams, requestSchema, alphaVantageConfigured, toTable } from '../alphavantage.js';

// Never selects blob_path or the requester: users only see what was downloaded, not where it is stored or by whom.
const LIST = `select id, function, symbol, market, params, filename, size_bytes::float8 as size_bytes, row_count, created_at,
                     coalesce(requested_by = $1, false) as mine,
                     exists(select 1 from market_data_access a where a.market_data_id = market_data.id and a.user_id = $1) as owned
                from market_data`;

async function hasAccess(userId: string, id: string): Promise<boolean> {
  return (await q('select 1 from market_data_access where user_id = $1 and market_data_id = $2', [userId, id])).rowCount! > 0;
}

async function requireAccess(userId: string, id: string) {
  if (!(await hasAccess(userId, id))) throw new HttpError(403, 'Buy this file for 1 credit to use or view it');
}

export default async function marketDataRoutes(app: FastifyInstance) {
  app.get('/market-data', { preHandler: requireUser }, async (req) => {
    const { rows } = await q(`${LIST} order by created_at desc limit 500`, [req.user!.id]);
    return { configured: alphaVantageConfigured(), items: rows };
  });

  app.post('/market-data', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const user = req.user!;
    const r = requestSchema.parse(req.body);
    if (!alphaVantageConfigured()) throw new HttpError(503, 'Market data downloads are not configured');

    // Provider quotas are small and shared by everyone, so cap downloads per user.
    const used = (
      await q("select count(*)::int n from market_data where requested_by = $1 and created_at > now() - interval '24 hours'", [user.id])
    ).rows[0].n;
    if (used >= config.ALPHAVANTAGE_DAILY_DOWNLOAD_LIMIT) throw new HttpError(429, 'Daily download limit reached');

    const label = `${r.symbol}${'market' in r ? ' / ' + r.market : ''}`;
    const paid = await spendCredits(user.id, PRICING.downloadCost, 'download', `Downloaded ${label}`, { meta: { function: r.function } });
    if (!paid) throw new HttpError(402, `You need ${PRICING.downloadCost} credits to download a new file`);
    const id = crypto.randomUUID();
    try {
      const { data, rows: rowCount } = await fetchSeries(r);
      const filename = makeFilename(r, new Date());
      const blobPath = `market/${id}/${filename}`;
      await putBlob(blobPath, data);
      const market = 'market' in r ? r.market : null;
      await q(
        `insert into market_data(id, function, symbol, market, params, filename, blob_path, size_bytes, row_count, requested_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, r.function, r.symbol, market, JSON.stringify(publicParams(r)), filename, blobPath, data.length, rowCount, user.id],
      );
      await q("insert into market_data_access(user_id, market_data_id, source) values ($1, $2, 'download')", [user.id, id]);
    } catch (e) {
      // Nothing was delivered, so the user gets the credits back.
      await grantCredits(user.id, PRICING.downloadCost, 'refund', `Refund: download of ${label} failed`).catch((err) => req.log.error(err, 'refund failed'));
      throw e;
    }
    await q("insert into usage_events(user_id, kind, meta) values ($1, 'market_download', $2)", [user.id, JSON.stringify({ function: r.function })]);
    return (await q(`${LIST} where id = $2`, [user.id, id])).rows[0];
  });

  // One-time purchase of access to a file someone else already downloaded. Afterwards it can be used and viewed freely.
  app.post('/market-data/:id/access', { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const user = req.user!;
    const file = (await q('select symbol, market, function from market_data where id = $1', [id])).rows[0];
    if (!file) throw new HttpError(404, 'Not found');
    if (await hasAccess(user.id, id)) return { ok: true, charged: 0 };

    const label = `${file.symbol}${file.market ? ' / ' + file.market : ''}`;
    const paid = await spendCredits(user.id, PRICING.accessCost, 'access', `Bought access to ${label}`, { meta: { marketDataId: id } });
    if (!paid) throw new HttpError(402, `You need ${PRICING.accessCost} credit to buy this file`);
    const ins = await q("insert into market_data_access(user_id, market_data_id, source) values ($1, $2, 'purchase') on conflict do nothing returning 1", [user.id, id]);
    if (!ins.rows[0]) {
      // Bought twice at the same moment: keep one purchase and refund the other.
      await grantCredits(user.id, PRICING.accessCost, 'refund', `Refund: ${label} was already yours`).catch((e) => req.log.error(e, 'refund failed'));
      return { ok: true, charged: 0 };
    }
    return { ok: true, charged: PRICING.accessCost };
  });

  // Viewer: the stored JSON as a table (newest first, first 500 rows).
  app.get('/market-data/:id/preview', { preHandler: requireUser }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = (await q('select filename, blob_path from market_data where id = $1', [id])).rows[0];
    if (!row) throw new HttpError(404, 'Not found');
    await requireAccess(req.user!.id, id);
    const table = toTable(JSON.parse((await getBlob(row.blob_path)).toString('utf8')));
    if (!table) throw new HttpError(422, 'This file has no time series to show');
    return { filename: row.filename, kind: 'table', ...table };
  });

  app.get('/market-data/:id/download', { preHandler: requireUser }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = (await q('select filename, blob_path from market_data where id = $1', [id])).rows[0];
    if (!row) throw new HttpError(404, 'Not found');
    await requireAccess(req.user!.id, id);
    return reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(await getBlob(row.blob_path));
  });

  // The person who downloaded a file (or an admin) can delete it, unless other people bought access to it.
  app.delete('/market-data/:id', { preHandler: requireUser }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const user = req.user!;
    const row = (await q('select requested_by, blob_path from market_data where id = $1', [id])).rows[0];
    if (!row || (row.requested_by !== user.id && user.role !== 'admin')) throw new HttpError(404, 'Not found');
    if (user.role !== 'admin') {
      const others = (await q('select count(*)::int n from market_data_access where market_data_id = $1 and user_id <> $2', [id, user.id])).rows[0].n;
      if (others > 0) throw new HttpError(409, 'Other users have bought this file, so it cannot be deleted');
    }
    await q('delete from market_data where id = $1', [id]);
    await deleteBlob(row.blob_path).catch((e) => req.log.warn(e, 'blob delete failed'));
    return { ok: true };
  });
}
