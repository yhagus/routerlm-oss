import { z } from "zod";

const ENCRYPTION_KEY_BYTES = 32;
const ENCRYPTION_KEY_HELP =
  "ENCRYPTION_KEY must be 32 random bytes in base64; generate one with `openssl rand -base64 32` (see .env.example)";

/** Environment variables the app needs; validated by ConfigModule at bootstrap. */
export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.url({ error: "DATABASE_URL is not set or not a URL; see .env.example" }),
  // The web app's origin: its server forwards dashboard calls here with this Origin.
  WEB_ORIGIN: z.url().default("http://localhost:3001"),
  REDIS_URL: z.url({ error: "REDIS_URL is not set or not a URL; see .env.example" }),
  // AES-256-GCM key that encrypts Provider Account keys at rest.
  ENCRYPTION_KEY: z
    .base64({ error: ENCRYPTION_KEY_HELP })
    .refine((value) => Buffer.from(value, "base64").length === ENCRYPTION_KEY_BYTES, {
      error: ENCRYPTION_KEY_HELP,
    }),
  // Spec "Records": the worker deletes Error Captures older than this.
  ERROR_CAPTURE_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  // ADR 0020: every instance reloads its snapshot this often, which bounds how
  // long a revoked API Key or a disabled Provider stays valid after a lost change notice.
  SNAPSHOT_RELOAD_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  // How long one Quota Meter reading may take before it counts as failed.
  QUOTA_READER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Where Catalog Gaps are read from: every provider's models, as one JSON document.
  MODELS_DEV_API_URL: z.url().default("https://models.dev/api.json"),
  // How long reading models.dev may take before the Catalog Gaps report comes back empty.
  MODELS_DEV_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type Env = z.infer<typeof envSchema>;
