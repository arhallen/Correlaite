import type pg from 'pg';
import { pool } from './db.js';

export interface Spent {
  charged: number;
  balance: number;
}

async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function record(c: pg.PoolClient, userId: string, delta: number, balance: number, kind: string, description: string, meta?: unknown) {
  await c.query(
    'insert into credit_transactions(user_id, amount, balance_after, kind, description, meta) values ($1,$2,$3,$4,$5,$6)',
    [userId, delta, balance, kind, description, meta === undefined ? null : JSON.stringify(meta)],
  );
}

/**
 * Takes credits off a balance atomically (row lock). Returns null when the balance is too low.
 * With `partial`, takes whatever is left up to `amount` instead (used after a run, whose length is only known afterwards).
 */
export async function spendCredits(
  userId: string,
  amount: number,
  kind: string,
  description: string,
  opts: { partial?: boolean; meta?: unknown } = {},
): Promise<Spent | null> {
  return tx(async (c) => {
    const cur = (await c.query('select credits from users where id = $1 for update', [userId])).rows[0];
    if (!cur) return null;
    if (!opts.partial && cur.credits < amount) return null;
    const charged = opts.partial ? Math.min(amount, cur.credits) : amount;
    const balance = cur.credits - charged;
    if (charged > 0) {
      await c.query('update users set credits = $2 where id = $1', [userId, balance]);
      await record(c, userId, -charged, balance, kind, description, opts.meta);
    }
    return { charged, balance };
  });
}

export async function grantCredits(userId: string, amount: number, kind: string, description: string, meta?: unknown): Promise<number> {
  return tx(async (c) => {
    const balance = (await c.query('update users set credits = credits + $2 where id = $1 returning credits', [userId, amount])).rows[0].credits;
    await record(c, userId, amount, balance, kind, description, meta);
    return balance;
  });
}

export async function getBalance(userId: string): Promise<number> {
  return (await pool.query('select credits from users where id = $1', [userId])).rows[0]?.credits ?? 0;
}
