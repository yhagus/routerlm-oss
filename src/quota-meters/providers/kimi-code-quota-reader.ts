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
  type QuotaReading,
  QuotaReadError,
} from "@/quota-meters/models/quota-reader.js";
import { QUOTA_READER_HTTP_CLIENT } from "./quota-reader-http-client.js";

const USAGES_PATH = "usages";

const FULL_PERCENT = 100;
const PERCENT_DECIMALS = 4;
const FIVE_HOURS_IN_SECONDS = 5 * 60 * 60;
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

function isNumeric(text: string): boolean {
  return text.trim() !== "" && Number.isFinite(Number(text));
}

const limitSchema = z.looseObject({
  used_ratio: z.union([z.number(), z.string().refine(isNumeric)]),
  reset_time: z.iso.datetime({ offset: true }),
});
type UsagesLimit = z.infer<typeof limitSchema>;

const usagesResponseSchema = z.object({
  usages: z.object({
    limit_5h: limitSchema.nullish(),
    limit_7d: limitSchema.nullish(),
    limit_month_total: limitSchema.nullish(),
    limit_month_code: limitSchema.nullish(),
  }),
});
type LimitField = keyof z.infer<typeof usagesResponseSchema>["usages"];

interface PlanLimit {
  field: LimitField;
  key: string;
  label: string;
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

@Injectable()
export class KimiCodeQuotaReader implements QuotaReader {
  constructor(@InjectHttpClient(QUOTA_READER_HTTP_CLIENT) private readonly http: HttpClient) {}

  async read(
    { secret: bearerCredential }: ProviderAccountCredential,
    { baseUrl }: QuotaReaderProvider,
  ): Promise<QuotaReading> {
    const body = await this.fetchUsages(bearerCredential, baseUrl);
    const parsed = usagesResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new QuotaReadError("Kimi answered the quota reading in an unknown shape", {
        cause: parsed.error,
      });
    }
    const { usages } = parsed.data;
    const meters = PLAN_LIMITS.flatMap((planLimit) => {
      const limit = usages[planLimit.field];
      return limit ? [meterOf(planLimit, limit)] : [];
    });
    return { meters, usageResetCount: null };
  }

  private async fetchUsages(bearerCredential: string, baseUrl: string): Promise<unknown> {
    const url = `${withoutTrailingSlash(baseUrl)}/${USAGES_PATH}`;
    try {
      const response = await this.http.get(url, {
        headers: { authorization: `Bearer ${bearerCredential}`, accept: "application/json" },
      });
      return response.data;
    } catch (error) {
      throw asQuotaReadError(error, "Kimi quota");
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
