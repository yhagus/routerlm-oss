import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

describe('The Alibaba Token Plan Catalog file', () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'alibaba-token-plan');
    if (!provider) throw new Error('the Catalog has no Alibaba Token Plan Provider');
    return provider;
  }

  it("ships the plan's Singapore chat host for API keys only, not flagged as Terms Risk", async () => {
    const provider = await shipped();

    expect(provider).toMatchObject({
      name: 'Alibaba Token Plan',
      endpoints: [
        {
          kind: 'chat',
          protocol: 'openai-chat',
          baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
        },
      ],
      authStyle: 'bearer',
      logo: 'alibabacloud',
      termsRisk: false,
      credentialKinds: ['api-key'],
      quirks: {},
    });
    expect(provider.quotaReader).toBeUndefined();
  });

  it("ships only the plan's chat models, leaving out auto and the retiring qwen4-max-preview", async () => {
    const { upstreamModels } = await shipped();

    expect(upstreamModels.every((model) => (model.kind ?? 'chat') === 'chat')).toBe(true);
    expect(upstreamModels.map((model) => model.upstreamModelId)).toEqual([
      'qwen4-max',
      'qwen3.8-max',
      'qwen3.8-flash',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.6-plus',
      'qwen3.6-flash',
      'deepseek-v4.1-flash',
      'deepseek-v4.1-flash-1017',
      'deepseek-v4-pro',
      'deepseek-v4-pro-0813',
      'deepseek-v4-flash-0731',
      'kimi-k2.7-code',
      'kimi-k2.6',
      'kimi-k2.5',
      'glm-5.3',
      'glm-5.2',
      'glm-5.1',
      'glm-5',
      'MiniMax-M2.5',
    ]);
  });

  it('prices Qwen4 Max at its Singapore pay-as-you-go prices', async () => {
    const { upstreamModels } = await shipped();

    expect(upstreamModels.find((model) => model.upstreamModelId === 'qwen4-max')).toMatchObject({
      inputPrice: 1.5,
      outputPrice: 4.5,
      cacheReadPrice: 0.075,
      cacheWritePrice: 1.875,
    });
  });

  it("ships the plan's night discount as an every-day Asia/Shanghai Pricing Window", async () => {
    const { pricingWindows } = await shipped();

    expect(pricingWindows).toMatchObject([
      {
        name: 'Alibaba Token Plan Night',
        timeZone: 'Asia/Shanghai',
        ranges: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], start: '22:00', end: '08:00' }],
      },
    ]);
  });

  it('prices Qwen3.8 Max at night', async () => {
    const { upstreamModels } = await shipped();

    expect(
      upstreamModels.find((model) => model.upstreamModelId === 'qwen3.8-max')?.windowPrices,
    ).toMatchObject([
      { pricingWindow: 'Alibaba Token Plan Night', inputPrice: 0.8, outputPrice: 2.4 },
    ]);
  });
});
