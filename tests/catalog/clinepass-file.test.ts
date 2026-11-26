import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

describe('The ClinePass Catalog file', () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'clinepass');
    if (!provider) throw new Error('the Catalog has no ClinePass Provider');
    return provider;
  }

  it("ships Cline's chat host asking for unwrapped answers, flagged as Terms Risk", async () => {
    const provider = await shipped();

    expect(provider).toMatchObject({
      name: 'ClinePass',
      endpoints: [
        { kind: 'chat', protocol: 'openai-chat', baseUrl: 'https://api.cline.bot/api/v1' },
      ],
      authStyle: 'bearer',
      logo: 'cline',
      termsRisk: true,
      quirks: { fixedHeaders: { 'x-response-format': 'openai' } },
    });
    expect(provider.quirks.exhaustedErrorCodes).toBeUndefined();
    expect(provider.quotaReader).toBeUndefined();
  });

  it('ships only the pass models that answered with a ClinePass key', async () => {
    const { upstreamModels } = await shipped();

    expect(upstreamModels.map((model) => model.upstreamModelId)).toEqual([
      'cline-pass/deepseek-v4.1-flash-1017',
      'cline-pass/deepseek-v4.1-flash',
      'cline-pass/deepseek-v4-pro',
      'cline-pass/glm-5.3-flash',
      'cline-pass/glm-5.3',
      'cline-pass/kimi-k3.1-pro',
      'cline-pass/kimi-k3',
      'cline-pass/minimax-m3.1-flash',
      'cline-pass/qwen3.8-max',
    ]);
  });

  it('prices DeepSeek V4 Pro at its peak reference price', async () => {
    const { upstreamModels } = await shipped();

    expect(
      upstreamModels.find((model) => model.upstreamModelId === 'cline-pass/deepseek-v4-pro'),
    ).toMatchObject({
      inputPrice: 1.32,
      outputPrice: 3.96,
      cacheReadPrice: 0.044,
      cacheWritePrice: 1.32,
    });
  });
});
