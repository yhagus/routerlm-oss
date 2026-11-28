import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

const HOST = 'https://tokenhub-intl.tencentmaas.com';
const PEAK_RANGES = [
  { weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
  { weekdays: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' },
];

describe('The Tencent TokenHub Catalog files', () => {
  async function shipped(slug: string) {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === slug);
    if (!provider) throw new Error(`the Catalog has no ${slug} Provider`);
    return provider;
  }

  async function shippedModel(slug: string, upstreamModelId: string) {
    const { upstreamModels } = await shipped(slug);
    return upstreamModels.find((model) => model.upstreamModelId === upstreamModelId);
  }

  it('ships pay-as-you-go TokenHub unverified on three bearer-key chat endpoints', async () => {
    const provider = await shipped('tencent-tokenhub-intl');

    expect(provider).toMatchObject({
      name: 'Tencent TokenHub API (International)',
      logo: 'tencent',
      endpoints: [
        { kind: 'chat', protocol: 'openai-chat', baseUrl: `${HOST}/v1` },
        { kind: 'chat', protocol: 'anthropic-messages', baseUrl: HOST },
        { kind: 'chat', protocol: 'openai-responses', baseUrl: `${HOST}/v1` },
      ],
      authStyle: 'bearer',
      credentialKinds: ['api-key'],
      termsRisk: false,
      verified: false,
      quirks: { exhaustedErrorCodes: ['401007', '401008'] },
    });
    expect(provider.plans).toBeUndefined();
  });

  it('ships the Token Plan unverified on its plan endpoints, with three Plans and no None', async () => {
    const provider = await shipped('tencent-tokenhub-token-plan');

    expect(provider).toMatchObject({
      name: 'Tencent TokenHub Token Plan',
      logo: 'tencent',
      endpoints: [
        { kind: 'chat', protocol: 'openai-chat', baseUrl: `${HOST}/plan/v3` },
        {
          kind: 'chat',
          protocol: 'anthropic-messages',
          baseUrl: `${HOST}/plan/anthropic`,
        },
      ],
      authStyle: 'bearer',
      termsRisk: false,
      verified: false,
      quirks: {},
      plans: [
        { value: 'Standard', name: 'Standard' },
        { value: 'Pro', name: 'Pro' },
        { value: 'Max', name: 'Max' },
      ],
    });
    expect(provider.allowsNoPlan).toBeUndefined();
    expect(provider.planReader).toBeUndefined();
    expect(provider.quotaReader).toBeUndefined();
  });

  it('leaves Responses off the models TokenHub serves there only by conversion', async () => {
    const hy4 = await shippedModel('tencent-tokenhub-intl', 'hy4');
    const glm = await shippedModel('tencent-tokenhub-intl', 'glm-5.2');
    const step = await shippedModel('tencent-tokenhub-intl', 'step-5-preview');

    expect([hy4?.protocols, glm?.protocols, step?.protocols]).toEqual([
      ['openai-chat', 'anthropic-messages', 'openai-responses'],
      ['openai-chat', 'anthropic-messages'],
      ['openai-chat', 'anthropic-messages'],
    ]);
  });

  it('ships the same models on both Providers, at the same pay-as-you-go prices', async () => {
    const payAsYouGo = await shipped('tencent-tokenhub-intl');
    const tokenPlan = await shipped('tencent-tokenhub-token-plan');

    const pricesOf = (provider: typeof payAsYouGo) =>
      provider.upstreamModels.map((model) => [
        model.upstreamModelId,
        model.inputPrice,
        model.outputPrice,
        model.cacheReadPrice,
      ]);

    expect(pricesOf(tokenPlan)).toEqual(pricesOf(payAsYouGo));
    expect(await shippedModel('tencent-tokenhub-token-plan', 'kimi-k3')).toMatchObject({
      protocols: ['openai-chat', 'anthropic-messages'],
      inputPrice: 3,
      outputPrice: 15,
      cacheReadPrice: 0.3,
      cacheWritePrice: null,
    });
  });

  it('prices DeepSeek V4.1 Flash off-peak, with its peak rates on weekday Beijing hours', async () => {
    const { pricingWindows } = await shipped('tencent-tokenhub-intl');
    const flash = await shippedModel('tencent-tokenhub-intl', 'deepseek-v4.1-flash');
    const pro = await shippedModel('tencent-tokenhub-intl', 'deepseek-v4-pro');

    expect(pricingWindows).toMatchObject([
      {
        name: 'TokenHub DeepSeek Peak',
        timeZone: 'Asia/Shanghai',
        ranges: PEAK_RANGES,
      },
    ]);
    expect(flash).toMatchObject({
      inputPrice: 0.15,
      outputPrice: 0.6,
      cacheReadPrice: 0.003,
      windowPrices: [
        {
          pricingWindow: 'TokenHub DeepSeek Peak',
          inputPrice: 0.3,
          outputPrice: 1.2,
          cacheReadPrice: 0.006,
        },
      ],
    });
    expect(pro?.windowPrices).toBeUndefined();
  });

  it('gives the Token Plan its own copy of the DeepSeek peak window', async () => {
    const { pricingWindows } = await shipped('tencent-tokenhub-token-plan');
    const flash = await shippedModel('tencent-tokenhub-token-plan', 'deepseek-v4.1-flash');

    expect(pricingWindows).toMatchObject([
      {
        name: 'TokenHub Token Plan DeepSeek Peak',
        timeZone: 'Asia/Shanghai',
        ranges: PEAK_RANGES,
      },
    ]);
    expect(flash?.windowPrices).toEqual([
      {
        pricingWindow: 'TokenHub Token Plan DeepSeek Peak',
        inputPrice: 0.3,
        outputPrice: 1.2,
        cacheReadPrice: 0.006,
      },
    ]);
  });

  it('prices Hy4 at its list prices, since the Catalog ships no limited-time sale', async () => {
    const hy4 = await shippedModel('tencent-tokenhub-intl', 'hy4');

    expect(hy4).toMatchObject({
      inputPrice: 0.834,
      outputPrice: 2.501,
      cacheReadPrice: 0.042,
    });
    expect(hy4?.windowPrices).toBeUndefined();
  });
});
