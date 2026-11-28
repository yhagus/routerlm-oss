import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

const HOST = 'https://api.orcarouter.ai';

describe('The OrcaRouter Catalog file', () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'orcarouter');
    if (!provider) throw new Error('the Catalog has no orcarouter Provider');
    return provider;
  }

  async function shippedModel(upstreamModelId: string) {
    const { upstreamModels } = await shipped();
    return upstreamModels.find((model) => model.upstreamModelId === upstreamModelId);
  }

  it('ships pay-as-you-go OrcaRouter unverified on three bearer-key chat endpoints', async () => {
    const provider = await shipped();

    expect(provider).toMatchObject({
      name: 'OrcaRouter',
      endpoints: [
        { kind: 'chat', protocol: 'openai-chat', baseUrl: `${HOST}/v1` },
        { kind: 'chat', protocol: 'anthropic-messages', baseUrl: HOST },
        { kind: 'chat', protocol: 'openai-responses', baseUrl: `${HOST}/v1` },
      ],
      authStyle: 'bearer',
      credentialKinds: ['api-key'],
      termsRisk: false,
      verified: false,
      quirks: {},
    });
    expect(provider.plans).toBeUndefined();
  });

  it('sends Claude models on Anthropic Messages, GPT models on Responses and the rest on chat completions', async () => {
    const claude = await shippedModel('anthropic/claude-sonnet-4.6');
    const gpt = await shippedModel('openai/gpt-5');
    const glm = await shippedModel('z-ai/glm-5.1');

    expect([claude?.protocols, gpt?.protocols, glm?.protocols]).toEqual([
      ['anthropic-messages', 'openai-chat'],
      ['openai-responses', 'openai-chat'],
      [],
    ]);
  });

  it("prices a model at its original Provider's list price, since OrcaRouter adds no markup", async () => {
    const opus = await shippedModel('anthropic/claude-opus-4.8');

    expect(opus).toMatchObject({
      inputPrice: 5,
      outputPrice: 25,
      cacheReadPrice: 0.5,
      cacheWritePrice: 6.25,
    });
  });

  it('leaves out the routers and the free models, which have no fixed price', async () => {
    const { upstreamModels } = await shipped();
    const ids = upstreamModels.map((model) => model.upstreamModelId);

    expect(ids).not.toContain('orcarouter/auto');
    expect(ids).not.toContain('deepseek/deepseek-v4-flash-free');
  });
});
