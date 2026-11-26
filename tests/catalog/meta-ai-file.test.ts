import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

describe('The Meta AI Catalog file', () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'meta-ai');
    if (!provider) throw new Error('the Catalog has no Meta AI Provider');
    return provider;
  }

  it('ships Meta AI on its Responses endpoint, not flagged as Terms Risk', async () => {
    const provider = await shipped();

    expect(provider).toMatchObject({
      endpoints: [
        { kind: 'chat', protocol: 'openai-responses', baseUrl: 'https://api.meta.ai/v1' },
      ],
      authStyle: 'bearer',
      logo: 'meta',
      termsRisk: false,
    });
  });

  it('ships the Muse Ember, Wonder and Spark chat models and no Contributor model', async () => {
    const { upstreamModels } = await shipped();

    expect(
      upstreamModels.map((model) => [model.upstreamModelId, model.inputPrice, model.outputPrice]),
    ).toEqual([
      ['muse-ember-1.0', 0.1, 0.5],
      ['muse-wonder-1.0', 4, 20],
      ['muse-spark-1.3', 1.25, 4.25],
      ['muse-spark-1.2', 1.25, 4.25],
      ['muse-spark-1.1', 1.25, 4.25],
    ]);
  });
});
