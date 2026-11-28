import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';

const HOST = 'https://api-inference.bitdeer.ai';

describe('The Bitdeer AI Catalog file', () => {
  async function shipped() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'bitdeer-ai');
    if (!provider) throw new Error('the Catalog has no bitdeer-ai Provider');
    return provider;
  }

  async function shippedModel(upstreamModelId: string) {
    const { upstreamModels } = await shipped();
    return upstreamModels.find((model) => model.upstreamModelId === upstreamModelId);
  }

  it('ships pay-as-you-go Bitdeer AI unverified on three bearer-key chat endpoints', async () => {
    const provider = await shipped();

    expect(provider).toMatchObject({
      name: 'Bitdeer AI',
      endpoints: [
        { kind: 'chat', protocol: 'openai-chat', baseUrl: `${HOST}/v1` },
        { kind: 'chat', protocol: 'anthropic-messages', baseUrl: HOST },
        { kind: 'chat', protocol: 'openai-responses', baseUrl: `${HOST}/v1` },
      ],
      authStyle: 'bearer',
      credentialKinds: ['api-key'],
      termsRisk: false,
      verified: false,
      quirks: { exhaustedErrorCodes: ['insufficient_balance', 'insufficient_quota'] },
    });
    expect(provider.plans).toBeUndefined();
  });

  it('ships only the chat models of the Model Catalog', async () => {
    const { upstreamModels } = await shipped();

    expect(upstreamModels.map((model) => [model.upstreamModelId, model.kind])).toEqual([
      ['deepseek-ai/DeepSeek-V4.1-Flash-1017', undefined],
      ['zai-org/GLM-5.3', undefined],
      ['zai-org/GLM-5.3-Flash', undefined],
      ['Qwen/Qwen3.8-27B', undefined],
      ['nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B', undefined],
    ]);
  });

  it('prices DeepSeek V4.1 Flash 1017 at its list prices, not the console discount', async () => {
    const flash = await shippedModel('deepseek-ai/DeepSeek-V4.1-Flash-1017');

    expect(flash).toMatchObject({
      inputPrice: 0.3,
      outputPrice: 1.2,
      cacheReadPrice: 0.006,
      cacheWritePrice: null,
    });
  });

  it('leaves structured output off GLM-5.3, which Bitdeer serves without JSON Schema mode', async () => {
    const glm = await shippedModel('zai-org/GLM-5.3');

    expect(glm?.capabilities).toEqual(['tools', 'reasoning']);
  });
});
