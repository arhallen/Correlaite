import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8080),
  APP_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/workbench'),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  ADMIN_EMAILS: z.string().default(''),
  ALLOW_SIGNUP: bool,
  ACS_CONNECTION_STRING: z.string().optional(),
  EMAIL_SENDER: z.string().optional(),
  STORAGE_CONNECTION_STRING: z.string().optional(),
  STORAGE_ACCOUNT_URL: z.string().optional(),
  STORAGE_CONTAINER: z.string().default('datasets'),
  SANDBOX_POOL_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-10-21'),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  DAILY_RUN_LIMIT: z.coerce.number().default(50),
  MAX_UPLOAD_MB: z.coerce.number().default(25),
});

export const config = schema.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
export const adminEmails = new Set(
  config.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
