import { z } from "zod";

/** Environment variables the app needs; validated by ConfigModule at bootstrap. */
export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.url({ error: "DATABASE_URL is not set or not a URL; see .env.example" }),
});

export type Env = z.infer<typeof envSchema>;
