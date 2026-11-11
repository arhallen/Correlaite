import './instrument.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool, q } from './db.js';
import { migrate } from './migrate.js';
import { HttpError } from './errors.js';
import authRoutes from './routes/auth.js';
import datasetRoutes from './routes/datasets.js';
import marketDataRoutes from './routes/marketData.js';
import runRoutes from './routes/runs.js';
import adminRoutes from './routes/admin.js';

const app = Fastify({ logger: true, trustProxy: true });

await app.register(helmet);
await app.register(cookie);
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });

// CSRF defence in depth (cookies are SameSite=Lax): state-changing requests must carry a custom header,
// which cross-site forms cannot send.
app.addHook('onRequest', async (req) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'correlaite') {
    throw new HttpError(403, 'Missing X-Requested-With header');
  }
});

app.setErrorHandler((err: any, req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', details: err.issues });
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
  const status = Number(err.statusCode ?? 500);
  if (status < 500) return reply.code(status).send({ error: err.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'Internal error' });
});

await app.register(
  async (api) => {
    api.get('/health', async () => {
      await q('select 1');
      return { ok: true };
    });
    await api.register(authRoutes);
    await api.register(datasetRoutes);
    await api.register(marketDataRoutes);
    await api.register(runRoutes);
    await api.register(adminRoutes);
  },
  { prefix: '/api' },
);

await migrate();
await app.listen({ port: config.PORT, host: '0.0.0.0' });

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
