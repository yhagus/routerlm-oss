import { Injectable } from '@nestjs/common';
import { HttpClient, InjectHttpClient } from '@nestjs/http-client';
import { z } from 'zod';
import type { ProviderAccountCredential } from '@/upstream/models/provider-account-credential';
import {
  asQuotaReadError,
  type QuotaReaderProvider,
  QuotaReadError,
} from '@/quota-meters/models/quota-reader';
import type {
  UsageResetOutcome,
  UsageResetPort,
  UsageResetReading,
  UsageResetToSpend,
} from '@/quota-meters/models/usage-reset';
import { codexBackendRequestOf } from './openai-codex-backend';
import { QUOTA_READER_HTTP_CLIENT } from './quota-reader-http-client';

const RESET_CREDITS_PATH = '/backend-api/wham/rate-limit-reset-credits';
const CONSUME_PATH = `${RESET_CREDITS_PATH}/consume`;

const UNTITLED_RESET = 'Usage reset';

const creditSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string(),
  title: z.string().nullish(),
  granted_at: z.iso.datetime({ offset: true }),
  expires_at: z.iso.datetime({ offset: true }).nullish(),
});

const creditsResponseSchema = z.looseObject({ credits: z.array(creditSchema) });

const consumeResponseSchema = z.looseObject({ code: z.string() });

const OUTCOMES_BY_CODE: ReadonlyMap<string, UsageResetOutcome> = new Map([
  ['reset', 'reset'],
  ['nothing_to_reset', 'nothing-to-reset'],
  ['no_credit', 'unavailable'],
  ['already_redeemed', 'unavailable'],
]);

@Injectable()
export class OpenAiCodexUsageResets implements UsageResetPort {
  constructor(@InjectHttpClient(QUOTA_READER_HTTP_CLIENT) private readonly http: HttpClient) {}

  async list(
    credential: ProviderAccountCredential,
    { baseUrl }: QuotaReaderProvider,
  ): Promise<UsageResetReading[]> {
    const { url, headers } = codexBackendRequestOf(credential, baseUrl, RESET_CREDITS_PATH);
    const body = await this.call(() => this.http.get(url, { headers }));
    const parsed = creditsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new QuotaReadError('OpenAI answered the usage reset list in an unknown shape', {
        cause: parsed.error,
      });
    }
    return parsed.data.credits
      .filter((credit) => credit.status === 'available')
      .map((credit) => ({
        externalId: credit.id,
        title: credit.title ?? UNTITLED_RESET,
        grantedAt: new Date(credit.granted_at),
        expiresAt: credit.expires_at ? new Date(credit.expires_at) : null,
        raw: credit,
      }));
  }

  async use(
    credential: ProviderAccountCredential,
    { baseUrl }: QuotaReaderProvider,
    { externalId, idempotencyKey }: UsageResetToSpend,
  ): Promise<UsageResetOutcome> {
    const { url, headers } = codexBackendRequestOf(credential, baseUrl, CONSUME_PATH);
    const body = await this.call(() =>
      this.http.post(url, {
        headers,
        json: { redeem_request_id: idempotencyKey, credit_id: externalId },
      }),
    );
    const parsed = consumeResponseSchema.safeParse(body);
    const outcome = parsed.success ? OUTCOMES_BY_CODE.get(parsed.data.code) : undefined;
    if (outcome === undefined) {
      throw new QuotaReadError('OpenAI answered spending a usage reset in an unknown shape', {
        cause: parsed.error,
      });
    }
    return outcome;
  }

  private async call(send: () => Promise<{ data: unknown }>): Promise<unknown> {
    try {
      const response = await send();
      return response.data;
    } catch (error) {
      throw asQuotaReadError(error, 'OpenAI usage resets');
    }
  }
}
