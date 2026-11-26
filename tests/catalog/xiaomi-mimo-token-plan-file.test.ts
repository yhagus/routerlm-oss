import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

describe('The Xiaomi MiMo Token Plan Catalog file', () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'xiaomi-mimo-token-plan');
    if (!provider) throw new Error('the Catalog has no Xiaomi MiMo Token Plan Provider');
    return provider;
  }

  it('ships the Token Plan on its Singapore cluster for API keys only, flagged as Terms Risk', async () => {
    const provider = await shipped();

    expect(provider).toMatchObject({
      endpoints: [
        {
          kind: 'chat',
          protocol: 'openai-chat',
          baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
        },
      ],
      authStyle: 'bearer',
      logo: 'xiaomimimo',
      termsRisk: true,
      credentialKinds: ['api-key'],
    });
    expect(provider.quotaReader).toBeUndefined();
  });

  it("ships the V2.6 Pro and Flash chat models at Xiaomi MiMo's pay-as-you-go prices", async () => {
    const { upstreamModels } = await shipped();

    expect(
      upstreamModels.map((model) => [model.upstreamModelId, model.inputPrice, model.outputPrice]),
    ).toEqual([
      ['mimo-v2.6-pro', 0.435, 0.87],
      ['mimo-v2.6-flash', 0.14, 0.28],
    ]);
  });
});
