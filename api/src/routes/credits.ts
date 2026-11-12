import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { q } from '../db.js';
import { requireUser } from '../auth.js';
import { HttpError } from '../errors.js';
import { getBalance, grantCredits } from '../credits.js';
import { PACKS, PRICING } from '../pricing.js';

export default async function creditRoutes(app: FastifyInstance) {
  // Lightweight: used by the header and warnings.
  app.get('/credits/balance', { preHandler: requireUser }, async (req) => ({ balance: await getBalance(req.user!.id), pricing: PRICING }));

  app.get('/credits', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const transactions = (
      await q(
        `select id::text, amount, balance_after, kind, description, created_at
           from credit_transactions where user_id = $1 order by created_at desc, id desc limit 100`,
        [user.id],
      )
    ).rows;
    return { balance: await getBalance(user.id), pricing: PRICING, packs: PACKS, transactions };
  });

  // Payment is mocked for now: the credits are granted without charging anything.
  // Replace `mockPayment` with a real payment provider (checkout session + webhook) before going live.
  app.post('/credits/purchase', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { packId } = z.object({ packId: z.enum(['small', 'medium', 'large']) }).parse(req.body);
    const pack = PACKS.find((p) => p.id === packId);
    if (!pack) throw new HttpError(400, 'Unknown credit pack');
    const payment = await mockPayment(pack.priceCents);
    const balance = await grantCredits(req.user!.id, pack.credits, 'purchase', `Bought ${pack.credits} credits (demo payment, nothing charged)`, {
      packId,
      priceCents: pack.priceCents,
      payment,
    });
    return { balance };
  });
}

async function mockPayment(priceCents: number) {
  return { provider: 'mock', status: 'paid', amountCents: priceCents, charged: false };
}
