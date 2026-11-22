import { Injectable } from "@nestjs/common";
import { HttpClient, InjectHttpClient } from "@nestjs/http-client";
import { z } from "zod";
import { withoutTrailingSlash } from "@/libs/models/url.js";
import type { ProviderAccountCredential } from "@/upstream/models/provider-account-credential.js";
import type { QuotaMeterReading } from "@/quota-meters/models/quota-meter.js";
import {
  asQuotaReadError,
  type QuotaReader,
  type QuotaReaderProvider,
  QuotaReadError,
} from "@/quota-meters/models/quota-reader.js";
import { QUOTA_READER_HTTP_CLIENT } from "./quota-reader-http-client.js";

const USAGES_PATH = "usages";

const FULL_PERCENT = 100;
/** Keeps a ratio such as 0.07 from becoming 7.000000000000001 percent. */
const PERCENT_DECIMALS = 4;
const FIVE_HOURS_IN_SECONDS = 5 * 60 * 60;
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

function isNumeric(text: string): boolean {
  return text.trim() !== "" && Number.isFinite(Number(text));
}

// Loose, so the meter's raw payload keeps whatever else Kimi sends for a limit.
const limitSchema = z.looseObject({
  /** From 0 to 1. Kimi sends it as a number or as a numeric string. */
  used_ratio: z.union([z.number(), z.string().refine(isNumeric)]),
  reset_time: z.iso.datetime({ offset: true }),
});
type UsagesLimit = z.infer<typeof limitSchema>;

// The answer's `limits` array and `boosterWallet` are left unread on purpose.
const usagesResponseSchema = z.object({
  usages: z.object({
    limit_5h: limitSchema.nullish(),
    limit_7d: limitSchema.nullish(),
    limit_month_total: limitSchema.nullish(),
    limit_month_code: limitSchema.nullish(),
  }),
});
type LimitField = keyof z.infer<typeof usagesResponseSchema>["usages"];

/** One limit a Kimi Code plan may report, and the meter it becomes. */
interface PlanLimit {
  field: LimitField;
  key: string;
  label: string;
  /** Null for a calendar month, whose length varies. */
  windowSeconds: number | null;
}

const PLAN_LIMITS = [
  { field: "limit_5h", key: "5h", label: "5-hour limit", windowSeconds: FIVE_HOURS_IN_SECONDS },
  { field: "limit_7d", key: "7d", label: "7-day limit", windowSeconds: SEVEN_DAYS_IN_SECONDS },
  { field: "limit_month_total", key: "month-total", label: "Monthly limit", windowSeconds: null },
  {
    field: "limit_month_code",
    key: "month-code",
    label: "Monthly code limit",
    windowSeconds: null,
  },
] as const satisfies PlanLimit[];

/**
 * Reads the limits of a Kimi Code plan from `GET <base URL>/usages`, which
 * takes the account's credential as a Bearer token. Kimi answers it for an
 * API key and for an OAuth Login's access token alike, as long as the request
 * carries no identity header besides `Authorization`.
 */
@Injectable()
export class KimiCodeQuotaReader implements QuotaReader {
  constructor(@InjectHttpClient(QUOTA_READER_HTTP_CLIENT) private readonly http: HttpClient) {}

  async read(
    { secret: bearerCredential }: ProviderAccountCredential,
    { baseUrl }: QuotaReaderProvider,
  ): Promise<QuotaMeterReading[]> {
    const body = await this.fetchUsages(bearerCredential, baseUrl);
    const parsed = usagesResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new QuotaReadError("Kimi answered the quota reading in an unknown shape", {
        cause: parsed.error,
      });
    }
    const { usages } = parsed.data;
    // Every meter is unscoped: any one limit running out stops the whole plan.
    return PLAN_LIMITS.flatMap((planLimit) => {
      const limit = usages[planLimit.field];
      return limit ? [meterOf(planLimit, limit)] : [];
    });
  }

  private async fetchUsages(bearerCredential: string, baseUrl: string): Promise<unknown> {
    const url = `${withoutTrailingSlash(baseUrl)}/${USAGES_PATH}`;
    try {
      const response = await this.http.get(url, {
        headers: { authorization: `Bearer ${bearerCredential}`, accept: "application/json" },
      });
      return response.data;
    } catch (error) {
      throw asQuotaReadError(error, "Kimi");
    }
  }
}

function meterOf(planLimit: PlanLimit, limit: UsagesLimit): QuotaMeterReading {
  const usedPercent = Number((Number(limit.used_ratio) * FULL_PERCENT).toFixed(PERCENT_DECIMALS));
  return {
    key: planLimit.key,
    label: planLimit.label,
    unit: "percent",
    used: usedPercent,
    limit: FULL_PERCENT,
    remainingPercent: Math.max(0, FULL_PERCENT - usedPercent),
    isUnlimited: false,
    windowSeconds: planLimit.windowSeconds,
    resetsAt: new Date(limit.reset_time),
    scope: null,
    raw: limit,
  };
}
