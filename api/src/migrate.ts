import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';

/** Applies migrations/*.sql in order. Safe to run from several replicas at once (advisory lock). */
export async function migrate() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(727274)');
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
    for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await client.query('begin');
      try {
        await client.query(await readFile(path.join(dir, f), 'utf8'));
        await client.query('insert into schema_migrations(name) values ($1)', [f]);
        await client.query('commit');
        console.log('applied migration', f);
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
