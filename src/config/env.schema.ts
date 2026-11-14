import { z } from "zod";

/** Environment variables the app needs; validated by ConfigModule at bootstrap. */
export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.url({ error: "DATABASE_URL is not set or not a URL; see .env.example" }),
  // The web app's origin: its server forwards dashboard calls here with this Origin.
  WEB_ORIGIN: z.url().default("http://localhost:3001"),
});

export type Env = z.infer<typeof envSchema>;
