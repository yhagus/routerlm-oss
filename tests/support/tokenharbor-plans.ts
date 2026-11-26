import type { Database } from '@/db/schemas/relations';
import { providers, upstreamModels } from '@/db/schemas';
import type { FakeReply } from './fake-upstream';

export const FREE_TIER_PATH = '/api/cli/free-tier';
export const MODELS_PATH = '/v1/models';

export function freeTierReply(planName: string | null): FakeReply {
  return {
    kind: 'json',
    status: 200,
    body: { plan_name: planName, free_tier_remaining: 0, free_tier_limit: 0 },
  };
}

export interface ListedModel {
  id: string;
  coveredByPlans: string[] | null;
}

export function modelsReply(listed: ListedModel[]): FakeReply {
  return {
    kind: 'json',
    status: 200,
    body: {
      object: 'list',
      data: listed.map((model) => ({
        id: model.id,
        object: 'model',
        owned_by: 'tokenharbor',
        covered_by_plans: model.coveredByPlans,
      })),
    },
  };
}

export const SERVER_ERROR_REPLY: FakeReply = {
  kind: 'json',
  status: 500,
  body: { error: { message: 'Internal error' } },
};

export async function insertTokenHarbor(
  db: Database,
  baseUrl: string,
  upstreamModelIds: string[],
): Promise<string> {
  const [provider] = await db
    .insert(providers)
    .values({
      slug: 'tokenharbor',
      name: 'TokenHarbor',
      endpoints: [
        { kind: 'chat', protocol: 'anthropic-messages', baseUrl: new URL(baseUrl).origin },
        { kind: 'chat', protocol: 'openai-chat', baseUrl },
      ],
      authStyle: 'bearer',
      planReader: 'tokenharbor',
    })
    .returning({ id: providers.id });
  if (upstreamModelIds.length === 0) {
    return provider.id;
  }
  await db.insert(upstreamModels).values(
    upstreamModelIds.map((upstreamModelId) => ({
      providerId: provider.id,
      upstreamModelId,
      capabilities: [],
      contextSize: 128_000,
    })),
  );
  return provider.id;
}
