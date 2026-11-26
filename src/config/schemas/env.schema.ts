import { z } from 'zod';

const ENCRYPTION_KEY_BYTES = 32;
const ENCRYPTION_KEY_HELP =
  'ENCRYPTION_KEY must be 32 random bytes in base64; generate one with `openssl rand -base64 32` (see .env.example)';

const MAX_PORT = 65_535;

export const controlPlanePortSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.coerce.number().int().min(1).max(MAX_PORT).optional(),
);

export const BACKEND_ROLES = ['all', 'inference', 'admin'] as const;

export type BackendRole = (typeof BACKEND_ROLES)[number];

export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  BACKEND_PROCESSES: z.coerce.number().int().min(1).default(1),
  BACKEND_ROLE: z.enum(BACKEND_ROLES).default('all'),
  DATABASE_URL: z.url({ error: 'DATABASE_URL is not set or not a URL; see .env.example' }),
  WEB_ORIGIN: z.url().default('http://localhost:3001'),
  REDIS_URL: z.url({ error: 'REDIS_URL is not set or not a URL; see .env.example' }),
  ENCRYPTION_KEY: z
    .base64({ error: ENCRYPTION_KEY_HELP })
    .refine((value) => Buffer.from(value, 'base64').length === ENCRYPTION_KEY_BYTES, {
      error: ENCRYPTION_KEY_HELP,
    }),
  TRUST_PROXY: z.string().optional(),
  ERROR_CAPTURE_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  SNAPSHOT_RELOAD_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  QUOTA_READER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  PROBE_IMAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  MODELS_DEV_API_URL: z.url().default('https://models.dev/api.json'),
  MODELS_DEV_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  CONTROL_PLANE_PORT: controlPlanePortSchema,
});

export type Env = z.infer<typeof envSchema>;
