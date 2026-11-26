import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

describe('The TokenHarbor Catalog file', () => {
  async function shippedTokenHarbor() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'tokenharbor');
    if (!provider) throw new Error('the Catalog has no tokenharbor Provider');
    return provider;
  }

  async function shippedModel(upstreamModelId: string) {
    const { upstreamModels } = await shippedTokenHarbor();
    return upstreamModels.find((model) => model.upstreamModelId === upstreamModelId);
  }

  it('ships TokenHarbor as one bearer-key Provider with three chat endpoints and no Terms Risk', async () => {
    const provider = await shippedTokenHarbor();

    expect(provider).toMatchObject({
      name: 'TokenHarbor',
      endpoints: [
        { kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://tokenharbor.ai/v1' },
        { kind: 'chat', protocol: 'anthropic-messages', baseUrl: 'https://tokenharbor.ai' },
        { kind: 'chat', protocol: 'openai-responses', baseUrl: 'https://tokenharbor.ai/v1' },
      ],
      authStyle: 'bearer',
      credentialKinds: ['api-key'],
      termsRisk: false,
    });
  });

  it('sends Claude on Anthropic Messages, GPT on Responses and the rest on the default endpoint', async () => {
    const claude = await shippedModel('claude-opus-5.5');
    const gpt = await shippedModel('gpt-6.2-sol');
    const glm = await shippedModel('glm-5.3');

    expect([claude?.protocols, gpt?.protocols, glm?.protocols]).toEqual([
      ['anthropic-messages', 'openai-chat'],
      ['openai-responses', 'openai-chat'],
      [],
    ]);
  });

  it('discounts exactly the four DeepSeek off-peak models from 14:00 to midnight UTC every day', async () => {
    const provider = await shippedTokenHarbor();

    const offPeakModels = provider.upstreamModels
      .filter((model) =>
        model.windowPrices?.some((entry) => entry.pricingWindow === 'TokenHarbor Off-Peak'),
      )
      .map((model) => model.upstreamModelId)
      .sort();

    expect(provider.pricingWindows).toEqual([
      expect.objectContaining({
        name: 'TokenHarbor Off-Peak',
        timeZone: 'UTC',
        ranges: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start: '14:00', end: '24:00' }],
      }),
    ]);
    expect(offPeakModels).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4.1-flash',
      'deepseek-v4.1-flash-1017',
    ]);
    expect(await shippedModel('deepseek-v4-pro')).toMatchObject({
      inputPrice: 1.32,
      windowPrices: [
        {
          pricingWindow: 'TokenHarbor Off-Peak',
          inputPrice: 0.66,
          outputPrice: 1.98,
          cacheReadPrice: 0.066,
        },
      ],
    });
  });

  it('leaves out the rotating free models', async () => {
    const { upstreamModels } = await shippedTokenHarbor();

    expect(upstreamModels.filter((model) => model.upstreamModelId.endsWith(':free'))).toEqual([]);
  });

  it('ships fast variants as their own models at their own prices', async () => {
    const base = await shippedModel('claude-opus-5.5');
    const fast = await shippedModel('claude-opus-5.5-fast');

    expect(base).toMatchObject({ inputPrice: 4, outputPrice: 20 });
    expect(fast).toMatchObject({
      name: 'Claude Opus 5.5 Fast',
      releaseDate: '2026-09-22',
      inputPrice: 8,
      outputPrice: 40,
    });
  });
});
