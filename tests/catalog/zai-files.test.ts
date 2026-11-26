import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

describe('The Z.ai Catalog files', () => {
  async function shipped(slug: string) {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === slug);
    if (!provider) throw new Error(`the Catalog has no ${slug} Provider`);
    return provider;
  }

  it('ships the GLM Coding Plan on its coding host, flagged as Terms Risk', async () => {
    const provider = await shipped('zai-coding-plan');

    expect(provider).toMatchObject({
      name: 'Z.ai GLM Coding Plan',
      endpoints: [
        {
          kind: 'chat',
          protocol: 'openai-chat',
          baseUrl: 'https://api.z.ai/api/coding/paas/v4',
        },
      ],
      authStyle: 'bearer',
      logo: 'zai',
      termsRisk: true,
    });
    expect(provider.quotaReader).toBeUndefined();
  });

  it("treats the Coding Plan's usage limit codes as Exhausted, but not its rate limits", async () => {
    const { quirks } = await shipped('zai-coding-plan');

    expect(quirks.exhaustedErrorCodes).toEqual([
      '1308',
      '1309',
      '1310',
      '1316',
      '1317',
      '1318',
      '1319',
      '1320',
      '1321',
    ]);
  });

  it('ships only the two models the Coding Plan docs name', async () => {
    const { upstreamModels } = await shipped('zai-coding-plan');

    expect(upstreamModels.map((model) => model.upstreamModelId)).toEqual([
      'glm-5.3',
      'glm-5.3-flash',
    ]);
  });

  it('ships the Z.ai API on its pay-as-you-go host, without Terms Risk or Exhausted codes', async () => {
    const provider = await shipped('zai');

    expect(provider).toMatchObject({
      name: 'Z.ai API',
      endpoints: [
        {
          kind: 'chat',
          protocol: 'openai-chat',
          baseUrl: 'https://api.z.ai/api/paas/v4',
        },
      ],
      authStyle: 'bearer',
      logo: 'zai',
    });
    expect(provider.termsRisk).toBeFalsy();
    expect(provider.quirks.exhaustedErrorCodes).toBeUndefined();
  });

  it('prices GLM-5.3 Flash on the Z.ai API at its list price', async () => {
    const { upstreamModels } = await shipped('zai');

    expect(upstreamModels.find((model) => model.upstreamModelId === 'glm-5.3-flash')).toMatchObject(
      {
        inputPrice: 0.15,
        outputPrice: 0.5,
        cacheReadPrice: 0.03,
        cacheWritePrice: 0.15,
      },
    );
  });
});
