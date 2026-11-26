import { Injectable } from '@nestjs/common';
import { HttpClient, InjectHttpClient } from '@nestjs/http-client';
import { z } from 'zod';
import type { ProviderEndpoint } from '@/db/schemas';
import type { ProviderAccountCredential } from '@/upstream/models/provider-account-credential';
import {
  asPlanReadError,
  type ListedPlanCoverage,
  type PlanReader,
  PlanReadError,
} from '@/plans/models/plan-reader';
import { PLAN_READER_HTTP_CLIENT } from './plan-reader-http-client';

const FREE_TIER_PATH = '/api/cli/free-tier';
const MODELS_PATH = '/models';

const freeTierResponseSchema = z.looseObject({
  plan_name: z.string().nullish(),
});

const modelsResponseSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      id: z.string(),
      covered_by_plans: z.array(z.string()).nullish(),
    }),
  ),
});

@Injectable()
export class TokenHarborPlanReader implements PlanReader {
  constructor(@InjectHttpClient(PLAN_READER_HTTP_CLIENT) private readonly http: HttpClient) {}

  async readPlan(
    credential: ProviderAccountCredential,
    endpoints: readonly ProviderEndpoint[],
  ): Promise<string | null> {
    const origin = new URL(openAiChatBaseUrlOf(endpoints)).origin;
    const body = await this.fetch(
      `${origin}${FREE_TIER_PATH}`,
      credential,
      'TokenHarbor free tier',
    );
    const parsed = freeTierResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PlanReadError('TokenHarbor answered the free tier in an unknown shape', {
        cause: parsed.error,
      });
    }
    return parsed.data.plan_name || null;
  }

  async readCoverage(
    credential: ProviderAccountCredential,
    endpoints: readonly ProviderEndpoint[],
  ): Promise<ListedPlanCoverage[]> {
    const url = `${openAiChatBaseUrlOf(endpoints)}${MODELS_PATH}`;
    const body = await this.fetch(url, credential, 'TokenHarbor models');
    const parsed = modelsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new PlanReadError('TokenHarbor answered the model listing in an unknown shape', {
        cause: parsed.error,
      });
    }
    return parsed.data.data.map((model) => ({
      upstreamModelId: model.id,
      planCoverage: model.covered_by_plans ?? null,
    }));
  }

  private async fetch(
    url: string,
    credential: ProviderAccountCredential,
    endpointName: string,
  ): Promise<unknown> {
    try {
      const response = await this.http.get(url, {
        headers: { ...credential.identityHeaders, authorization: `Bearer ${credential.secret}` },
      });
      return response.data;
    } catch (error) {
      throw asPlanReadError(error, endpointName);
    }
  }
}

function openAiChatBaseUrlOf(endpoints: readonly ProviderEndpoint[]): string {
  const endpoint = endpoints.find((candidate) => candidate.protocol === 'openai-chat');
  if (endpoint === undefined) {
    throw new PlanReadError('The Provider has no openai-chat endpoint to read its Plans from');
  }
  return endpoint.baseUrl;
}
