import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { deleteBlob, getBlob, putBlob } from '../storage.js';
import { hasAllowedExt, safeFilename } from '../util.js';

export default async function datasetRoutes(app: FastifyInstance) {
  app.get('/datasets', { preHandler: requireUser }, async (req) => {
    const { rows } = await q(
      'select id, filename, size_bytes::float8 as size_bytes, created_at from datasets where user_id = $1 order by created_at desc',
      [req.user!.id],
    );
    return rows;
  });

  app.post('/datasets', { preHandler: requireUser }, async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'No file uploaded');
    const filename = safeFilename(file.filename);
    if (!hasAllowedExt(filename)) throw new HttpError(400, 'Unsupported file type (csv, tsv, json, xlsx, parquet, txt)');
    const buf = await file.toBuffer(); // throws 413 when over the multipart size limit
    const id = crypto.randomUUID();
    const blobPath = `${req.user!.id}/${id}/${filename}`;
    await putBlob(blobPath, buf);
    const { rows } = await q(
      'insert into datasets(id, user_id, filename, blob_path, size_bytes) values ($1,$2,$3,$4,$5) returning id, filename, size_bytes::float8 as size_bytes, created_at',
      [id, req.user!.id, filename, blobPath, buf.length],
    );
    await q("insert into usage_events(user_id, kind, quantity) values ($1, 'upload_bytes', $2)", [req.user!.id, Math.min(buf.length, 2_000_000_000)]);
    return rows[0];
  });

  // Viewer: text formats show the first 100 KB; binary formats (xlsx, parquet) can only be downloaded.
  app.get('/datasets/:id/preview', { preHandler: requireUser }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = (await q('select filename, blob_path from datasets where id = $1 and user_id = $2', [id, req.user!.id])).rows[0];
    if (!row) throw new HttpError(404, 'Not found');
    if (!/\.(csv|tsv|json|txt)$/i.test(row.filename)) return { filename: row.filename, kind: 'binary' };
    const data = await getBlob(row.blob_path);
    const max = 100_000;
    return { filename: row.filename, kind: 'text', text: data.subarray(0, max).toString('utf8'), truncated: data.length > max };
  });

  app.get('/datasets/:id/download', { preHandler: requireUser }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = (await q('select filename, blob_path from datasets where id = $1 and user_id = $2', [id, req.user!.id])).rows[0];
    if (!row) throw new HttpError(404, 'Not found');
    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(await getBlob(row.blob_path));
  });

  app.delete('/datasets/:id', { preHandler: requireUser }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rows } = await q('delete from datasets where id = $1 and user_id = $2 returning blob_path', [id, req.user!.id]);
    if (!rows[0]) throw new HttpError(404, 'Not found');
    await deleteBlob(rows[0].blob_path).catch((e) => req.log.warn(e, 'blob delete failed'));
    return { ok: true };
  });
}
