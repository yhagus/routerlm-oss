import { Injectable } from "@nestjs/common";
import { HttpClient, InjectHttpClient } from "@nestjs/http-client";
import { z } from "zod";
import { SECOND_MS } from "@/libs/models/duration.js";
import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential.js";
import type { QuotaMeterReading } from "@/quota-meters/models/quota-meter.js";
import {
  asQuotaReadError,
  type QuotaReader,
  type QuotaReaderProvider,
  type QuotaReading,
  QuotaReadError,
} from "@/quota-meters/models/quota-reader.js";
import { codexBackendRequestOf } from "./openai-codex-backend.js";
import { OpenAiCodexUsageResets } from "./openai-codex-usage-resets.js";
import { QUOTA_READER_HTTP_CLIENT } from "./quota-reader-http-client.js";

/** On the origin of the Provider's base URL (`https://chatgpt.com/backend-api/codex`). */
const USAGE_PATH = "/backend-api/wham/usage";

const FULL_PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

/** The windows the Codex CLI names; any other length is keyed by its duration. */
const NAMED_WINDOWS: ReadonlyMap<number, { key: string; label: string }> = new Map([
  [5 * SECONDS_PER_HOUR, { key: "5h", label: "5-hour limit" }],
  [SECONDS_PER_WEEK, { key: "weekly", label: "Weekly limit" }],
]);

/** Duration units for a window key, largest first, as `2h` or `3d`. */
const DURATION_UNITS = [
  { seconds: SECONDS_PER_DAY, suffix: "d", label: "day" },
  { seconds: SECONDS_PER_HOUR, suffix: "h", label: "hour" },
  { seconds: SECONDS_PER_MINUTE, suffix: "m", label: "minute" },
  { seconds: 1, suffix: "s", label: "second" },
] as const;

// Loose, so a meter's raw payload keeps whatever else OpenAI sends.
const windowSchema = z.looseObject({
  used_percent: z.number(),
  limit_window_seconds: z.int().positive(),
  /** Epoch seconds. */
  reset_at: z.number(),
});
type UsageWindow = z.infer<typeof windowSchema>;

const rateLimitSchema = z.looseObject({
  primary_window: windowSchema.nullish(),
  secondary_window: windowSchema.nullish(),
});
type RateLimit = z.infer<typeof rateLimitSchema>;

// Credits are left unread on purpose: they stay in each meter's raw payload.
const usageResponseSchema = z.looseObject({
  rate_limit: rateLimitSchema.nullish(),
  additional_rate_limits: z
    .array(z.looseObject({ limit_name: z.string().min(1), rate_limit: rateLimitSchema.nullish() }))
    .nullish(),
  // A count in an unexpected shape loses only the count, never the meters.
  rate_limit_reset_credits: z
    .looseObject({ available_count: z.int().nonnegative().nullish() })
    .nullish()
    .catch(null),
});

/**
 * Reads the windows of a ChatGPT plan from `GET <Provider origin>/backend-api/wham/usage`,
 * which the Codex CLI calls with its OAuth Login's access token, ChatGPT
 * account id and CLI identity headers (ADR 0013).
 */
@Injectable()
export class OpenAiCodexQuotaReader implements QuotaReader {
  constructor(
    @InjectHttpClient(QUOTA_READER_HTTP_CLIENT) private readonly http: HttpClient,
    readonly usageResets: OpenAiCodexUsageResets,
  ) {}

  async read(
    credential: ProviderAccountCredential,
    { baseUrl }: QuotaReaderProvider,
  ): Promise<QuotaReading> {
    const body = await this.fetchUsage(credential, baseUrl);
    const parsed = usageResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new QuotaReadError("OpenAI answered the quota reading in an unknown shape", {
        cause: parsed.error,
      });
    }
    const {
      rate_limit: rateLimit,
      additional_rate_limits: additionalRateLimits,
      rate_limit_reset_credits: usageResetCredits,
    } = parsed.data;
    // Every meter keeps the whole answer raw, so the plan's credits are not lost.
    const plan = metersOf(rateLimit, null, body);
    const additional = (additionalRateLimits ?? []).flatMap((limit) =>
      metersOf(limit.rate_limit, limit.limit_name, body),
    );
    return {
      meters: [...plan, ...additional],
      usageResetCount: usageResetCredits?.available_count ?? null,
    };
  }

  private async fetchUsage(
    credential: ProviderAccountCredential,
    baseUrl: string,
  ): Promise<unknown> {
    const { url, headers } = codexBackendRequestOf(credential, baseUrl, USAGE_PATH);
    try {
      const response = await this.http.get(url, { headers });
      return response.data;
    } catch (error) {
      throw asQuotaReadError(error, "OpenAI");
    }
  }
}

/** The meters of one rate limit; a scoped one covers only the limit it names. */
function metersOf(
  rateLimit: RateLimit | null | undefined,
  scope: string | null,
  raw: unknown,
): QuotaMeterReading[] {
  const windows = [rateLimit?.primary_window, rateLimit?.secondary_window];
  return windows.flatMap((window) => (window ? [meterOf(window, scope, raw)] : []));
}

function meterOf(window: UsageWindow, scope: string | null, raw: unknown): QuotaMeterReading {
  const { key, label } = namedWindowOf(window.limit_window_seconds);
  const usedPercent = window.used_percent;
  return {
    key: scope === null ? key : `${key}:${scope}`,
    label: scope === null ? label : `${label} (${scope})`,
    unit: "percent",
    used: usedPercent,
    limit: FULL_PERCENT,
    remainingPercent: Math.max(0, FULL_PERCENT - usedPercent),
    isUnlimited: false,
    windowSeconds: window.limit_window_seconds,
    resetsAt: new Date(window.reset_at * SECOND_MS),
    scope,
    raw,
  };
}

function namedWindowOf(windowSeconds: number): { key: string; label: string } {
  const named = NAMED_WINDOWS.get(windowSeconds);
  if (named) {
    return named;
  }
  // The last unit, one second, divides every whole number of seconds.
  const unit =
    DURATION_UNITS.find((candidate) => windowSeconds % candidate.seconds === 0) ??
    DURATION_UNITS[DURATION_UNITS.length - 1];
  const count = windowSeconds / unit.seconds;
  return { key: `${count}${unit.suffix}`, label: `${count}-${unit.label} limit` };
}
