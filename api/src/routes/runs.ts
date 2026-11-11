import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';
import { config } from '../config.js';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { generateCode } from '../ai.js';
import { downloadFile, executeCode, listFiles, sandboxConfigured, uploadFile } from '../sandbox.js';
import { getBlob, putBlob } from '../storage.js';
import { safeFilename } from '../util.js';

const body = z.object({ prompt: z.string().trim().min(1).max(4000), datasetId: z.string().uuid().optional() });
const MAX_OUTPUT_FILES = 20;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', txt: 'text/plain', html: 'text/html',
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parquet: 'application/octet-stream',
};
const typeOf = (name: string) => TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
const FILES = `coalesce((select json_agg(json_build_object('id', f.id, 'filename', f.filename, 'content_type', f.content_type, 'size_bytes', f.size_bytes) order by f.filename)
  from run_files f where f.run_id = runs.id), '[]'::json) as files`;
const COLS = `id, dataset_id, prompt, code, status, stdout, stderr, result, duration_ms, created_at, ${FILES}`;

export default async function runRoutes(app: FastifyInstance) {
  app.get('/runs', { preHandler: requireUser }, async (req) => {
    const { rows } = await q(`select ${COLS} from runs where user_id = $1 order by created_at desc limit 50`, [req.user!.id]);
    return rows;
  });

  app.get('/runs/:id/files/:fileId', { preHandler: requireUser }, async (req, reply) => {
    const { id, fileId } = z.object({ id: z.string().uuid(), fileId: z.string().uuid() }).parse(req.params);
    const row = (
      await q(
        'select f.filename, f.content_type, f.blob_path from run_files f join runs r on r.id = f.run_id where f.id = $1 and r.id = $2 and r.user_id = $3',
        [fileId, id, req.user!.id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'Not found');
    const inline = row.content_type.startsWith('image/') && row.content_type !== 'image/svg+xml';
    return reply
      .header('Content-Type', row.content_type)
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${row.filename.replace(/"/g, '')}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, max-age=3600')
      .send(await getBlob(row.blob_path));
  });

  app.post('/runs', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const user = req.user!;
    const b = body.parse(req.body);

    // Fail closed: generated code is never executed anywhere except the network-isolated sandbox.
    if (!sandboxConfigured()) throw new HttpError(503, 'Code sandbox is not configured');

    const used = (
      await q("select count(*)::int n from runs where user_id = $1 and created_at > now() - interval '24 hours'", [user.id])
    ).rows[0].n;
    if (used >= config.DAILY_RUN_LIMIT) throw new HttpError(429, 'Daily run limit reached');

    let dataset: { filename: string; blob_path: string } | null = null;
    if (b.datasetId) {
      dataset = (await q('select filename, blob_path from datasets where id = $1 and user_id = $2', [b.datasetId, user.id])).rows[0] ?? null;
      if (!dataset) throw new HttpError(404, 'Dataset not found');
    }

    const run = (
      await q("insert into runs(user_id, dataset_id, prompt, status) values ($1,$2,$3,'running') returning id", [
        user.id,
        b.datasetId ?? null,
        b.prompt,
      ])
    ).rows[0];

    let tokens = 0;
    try {
      const gen = await generateCode(b.prompt, dataset);
      tokens = gen.tokens;
      await q('update runs set code = $2 where id = $1', [run.id, gen.code]);

      const identifier = `run-${run.id}`; // fresh sandbox session per run
      if (dataset) {
        await uploadFile(identifier, dataset.filename, await getBlob(dataset.blob_path));
        const files = await listFiles(identifier).catch((e) => { req.log.warn(e, 'sandbox file listing failed'); return null; });
        req.log.info({ identifier, dataset: dataset.filename, files }, 'dataset uploaded to sandbox');
        if (files && !files.some((f) => f.endsWith(dataset!.filename))) {
          throw new HttpError(502, `Dataset ${dataset.filename} did not arrive in the sandbox`);
        }
      }
      const res = await executeCode(identifier, gen.code);

      // Collect files the code produced (charts, CSVs, ...) so they are available on the website.
      try {
        const inputs = new Set(dataset ? [dataset.filename] : []);
        let total = 0;
        let count = 0;
        for (const name of await listFiles(identifier)) {
          const fname = safeFilename(name);
          if (!name || inputs.has(name) || count >= MAX_OUTPUT_FILES) continue;
          const data = await downloadFile(identifier, name);
          total += data.length;
          if (total > MAX_OUTPUT_BYTES) break;
          const blobPath = `${user.id}/runs/${run.id}/${fname}`;
          await putBlob(blobPath, data);
          await q('insert into run_files(run_id, filename, content_type, size_bytes, blob_path) values ($1,$2,$3,$4,$5)', [
            run.id, fname, typeOf(fname), data.length, blobPath,
          ]);
          count++;
        }
      } catch (e) {
        req.log.warn(e, 'collecting output files failed');
      }
      await q('update runs set status=$2, stdout=$3, stderr=$4, result=$5, duration_ms=$6 where id = $1', [
        run.id,
        res.status,
        res.stdout,
        res.stderr,
        res.result,
        res.durationMs,
      ]);
    } catch (e) {
      req.log.error(e, 'run failed');
      const msg = e instanceof HttpError ? e.message : 'Internal error';
      await q("update runs set status='error', stderr=$2 where id = $1", [run.id, `Run failed: ${msg}`]);
    }

    await q("insert into usage_events(user_id, kind, quantity) values ($1,'run',1), ($1,'tokens',$2)", [user.id, tokens]);
    return (await q(`select ${COLS} from runs where id = $1`, [run.id])).rows[0];
  });
}
