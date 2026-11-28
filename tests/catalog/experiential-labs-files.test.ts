import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

const HOST = 'https://api.experientiallabs.ai';

describe('The Experiential Labs Catalog file', () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'experiential-labs');
    if (!provider) throw new Error('the Catalog has no experiential-labs Provider');
    return provider;
  }

  async function shippedModel(upstreamModelId: string) {
    const { upstreamModels } = await shipped();
    return upstreamModels.find((model) => model.upstreamModelId === upstreamModelId);
  }

  it('ships pay-as-you-go Experiential Labs unverified on three bearer-key chat endpoints', async () => {
    const provider = await shipped();

    expect(provider).toMatchObject({
      name: 'Experiential Labs',
      endpoints: [
        { kind: 'chat', protocol: 'openai-chat', baseUrl: `${HOST}/v1` },
        { kind: 'chat', protocol: 'anthropic-messages', baseUrl: HOST },
        { kind: 'chat', protocol: 'openai-responses', baseUrl: `${HOST}/v1` },
      ],
      authStyle: 'bearer',
      credentialKinds: ['api-key'],
      termsRisk: false,
      verified: false,
      quirks: { exhaustedErrorCodes: ['insufficient_quota'] },
    });
    expect(provider.plans).toBeUndefined();
    expect(provider.modelsDevProviderId).toBeUndefined();
  });

  it('sends Claude on Anthropic Messages, GPT on Responses and the rest on chat completions', async () => {
    const claude = await shippedModel('claude-opus-5.5');
    const gpt = await shippedModel('gpt-6.1-sol');
    const kimi = await shippedModel('kimi-k3');

    expect([claude?.protocols, gpt?.protocols, kimi?.protocols]).toEqual([
      ['anthropic-messages', 'openai-chat'],
      ['openai-responses', 'openai-chat'],
      [],
    ]);
  });

  it('prices a model at its platform-funded route, converted from nano-USD', async () => {
    expect(await shippedModel('claude-opus-5.5')).toMatchObject({
      inputPrice: 4,
      outputPrice: 20,
      cacheReadPrice: 0.2,
      cacheWritePrice: 5,
      contextSize: 1_000_000,
      maxOutputTokens: 128_000,
    });
  });

  it('ships the uncensored variants at their own prices', async () => {
    expect(await shippedModel('glm-5.3-uncensored')).toMatchObject({
      inputPrice: 1.4,
      outputPrice: 4.4,
      cacheReadPrice: 0.26,
      cacheWritePrice: 1.4,
    });
    expect(await shippedModel('deepseek-v4.1-flash-uncensored')).toMatchObject({
      inputPrice: 0.225,
      outputPrice: 0.9,
      cacheReadPrice: 0.0225,
    });
  });

  it('leaves out batch-only models and the decision models without an output price', async () => {
    const shippedIds = (await shipped()).upstreamModels.map((model) => model.upstreamModelId);

    expect(shippedIds).not.toContain('claude-opus-5.5-batch');
    expect(shippedIds).not.toContain('clef');
    expect(shippedIds).not.toContain('gpt-6-luna-decisions');
  });
});
