import { Injectable } from '@nestjs/common';
import { HttpClient, InjectHttpClient } from '@nestjs/http-client';
import { z } from 'zod';
import { withoutTrailingSlash } from '@/libs/models/url';
import type { ProviderAccountCredential } from '@/upstream/models/provider-account-credential';
import type { QuotaMeterReading } from '@/quota-meters/models/quota-meter';
import {
  asQuotaReadError,
  type QuotaReader,
  type QuotaReaderProvider,
  type QuotaReading,
  QuotaReadError,
} from '@/quota-meters/models/quota-reader';
import { QUOTA_READER_HTTP_CLIENT } from './quota-reader-http-client';

const REMAINS_PATH = 'token_plan/remains';

const GENERAL_MODEL_GROUP = 'general';
const UNLIMITED_STATUS = 3;
const MS_PER_SECOND = 1000;

const remainsEntrySchema = z.object({
  model_name: z.string(),
  start_time: z.number(),
  end_time: z.number(),
  current_interval_total_count: z.number(),
  current_interval_usage_count: z.number(),
  current_interval_status: z.number(),
  current_interval_remaining_percent: z.number(),
  weekly_start_time: z.number(),
  weekly_end_time: z.number(),
  current_weekly_total_count: z.number(),
  current_weekly_usage_count: z.number(),
  current_weekly_status: z.number(),
  current_weekly_remaining_percent: z.number(),
});
type RemainsEntry = z.infer<typeof remainsEntrySchema>;

const remainsResponseSchema = z.object({
  base_resp: z.object({ status_code: z.number(), status_msg: z.string() }),
  model_remains: z.array(remainsEntrySchema).optional(),
});

type EntryField = Exclude<keyof RemainsEntry, 'model_name'>;

interface PlanWindow {
  key: string;
  label: string;
  startField: EntryField;
  endField: EntryField;
  totalCountField: EntryField;
  usageCountField: EntryField;
  statusField: EntryField;
  remainingPercentField: EntryField;
}

const PLAN_WINDOWS = [
  {
    key: '5h',
    label: '5-hour window',
    startField: 'start_time',
    endField: 'end_time',
    totalCountField: 'current_interval_total_count',
    usageCountField: 'current_interval_usage_count',
    statusField: 'current_interval_status',
    remainingPercentField: 'current_interval_remaining_percent',
  },
  {
    key: 'weekly',
    label: 'Weekly window',
    startField: 'weekly_start_time',
    endField: 'weekly_end_time',
    totalCountField: 'current_weekly_total_count',
    usageCountField: 'current_weekly_usage_count',
    statusField: 'current_weekly_status',
    remainingPercentField: 'current_weekly_remaining_percent',
  },
] as const satisfies PlanWindow[];

@Injectable()
export class MiniMaxMPlanQuotaReader implements QuotaReader {
  constructor(@InjectHttpClient(QUOTA_READER_HTTP_CLIENT) private readonly http: HttpClient) {}

  async read(
    { secret: bearerCredential }: ProviderAccountCredential,
    { quotaBaseUrl }: QuotaReaderProvider,
  ): Promise<QuotaReading> {
    if (quotaBaseUrl === undefined) {
      throw new QuotaReadError('The Provider names no quota endpoint in its quotaBaseUrl quirk');
    }
    const body = await this.fetchRemains(bearerCredential, quotaBaseUrl);
    const parsed = remainsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new QuotaReadError('MiniMax answered the quota reading in an unknown shape', {
        cause: parsed.error,
      });
    }
    const { base_resp: status, model_remains: entries } = parsed.data;
    if (status.status_code !== 0) {
      throw new QuotaReadError(
        `MiniMax refused the quota reading: ${status.status_code} ${status.status_msg}`,
      );
    }
    const meters = (entries ?? []).flatMap((entry) =>
      PLAN_WINDOWS.map((window) => meterOf(entry, window)),
    );
    return { meters, usageResetCount: null };
  }

  private async fetchRemains(bearerCredential: string, quotaBaseUrl: string): Promise<unknown> {
    const url = `${withoutTrailingSlash(quotaBaseUrl)}/${REMAINS_PATH}`;
    try {
      const response = await this.http.get(url, {
        headers: { authorization: `Bearer ${bearerCredential}` },
      });
      return response.data;
    } catch (error) {
      throw asQuotaReadError(error, 'MiniMax quota');
    }
  }
}

function meterOf(entry: RemainsEntry, window: PlanWindow): QuotaMeterReading {
  const isGeneral = entry.model_name === GENERAL_MODEL_GROUP;
  const totalCount = entry[window.totalCountField];
  const hasCounts = totalCount > 0;
  return {
    key: isGeneral ? window.key : `${window.key}:${entry.model_name}`,
    label: isGeneral ? window.label : `${window.label} (${entry.model_name})`,
    unit: hasCounts ? 'count' : 'percent',
    used: hasCounts ? entry[window.usageCountField] : null,
    limit: hasCounts ? totalCount : null,
    remainingPercent: entry[window.remainingPercentField],
    isUnlimited: entry[window.statusField] === UNLIMITED_STATUS,
    windowSeconds: Math.round((entry[window.endField] - entry[window.startField]) / MS_PER_SECOND),
    resetsAt: new Date(entry[window.endField]),
    scope: isGeneral ? null : entry.model_name,
    raw: entry,
  };
}
