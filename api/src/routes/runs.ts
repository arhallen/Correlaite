import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';
import { config } from '../config.js';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { generateCode } from '../ai.js';
import { executeCode, listFiles, sandboxConfigured, uploadFile } from '../sandbox.js';
import { getBlob } from '../storage.js';

const body = z.object({ prompt: z.string().trim().min(1).max(4000), datasetId: z.string().uuid().optional() });
const COLS = 'id, dataset_id, prompt, code, status, stdout, stderr, result, duration_ms, created_at';

export default async function runRoutes(app: FastifyInstance) {
  app.get('/runs', { preHandler: requireUser }, async (req) => {
    const { rows } = await q(`select ${COLS} from runs where user_id = $1 order by created_at desc limit 50`, [req.user!.id]);
    return rows;
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
