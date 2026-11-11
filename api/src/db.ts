import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  // TODO: pin the Azure Postgres CA bundle and switch to rejectUnauthorized: true
  ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export const q = <T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) =>
  pool.query<T>(text, params);
