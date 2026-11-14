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
});

export type Env = z.infer<typeof envSchema>;
