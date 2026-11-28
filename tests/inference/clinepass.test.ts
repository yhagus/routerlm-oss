import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';
import type { CatalogProviderQuirks } from '@/catalog/schemas/catalog.schema';
import type { Database } from '@/db/schemas/relations';
import { type FakeReply, FakeUpstream } from '@tests/support/fake-upstream';
import {
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_KEY,
} from '@tests/support/inference';
import { createTestApp } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };

const COMPLETION: FakeReply = {
  kind: 'json',
  status: 200,
  body: {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    model: 'upstream-model',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'Hello.' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  },
};

const STREAMED_COMPLETION: FakeReply = {
  kind: 'stream',
  events: [
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: 'Hello.' } }] },
    { id: 'chatcmpl-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join('')
    .concat('data: [DONE]\n\n'),
};

describe('Inference from ClinePass (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(app);
    ({ providerId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    await setProviderQuirks(app, db, providerId, await catalogQuirks());
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function catalogQuirks(): Promise<CatalogProviderQuirks> {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'clinepass');
    if (!provider) throw new Error('the Catalog has no ClinePass Provider');
    return provider.quirks;
  }

  function chat() {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`);
  }

  it("asks for the OpenAI response format on a non-streaming request, with the account's credential", async () => {
    upstream.reply(COMPLETION);

    await chat().send(TEXT_REQUEST).expect(200);

    const { headers } = upstream.lastRequest;
    expect(headers['x-response-format']).toBe('openai');
    expect(headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
  });

  it('asks for the OpenAI response format on a streaming request', async () => {
    upstream.reply(STREAMED_COMPLETION);

    await chat()
      .send({ ...TEXT_REQUEST, stream: true })
      .expect(200);

    expect(upstream.lastRequest.headers['x-response-format']).toBe('openai');
  });

  it('keeps a fixed header when the client sends a forwarded header of the same name', async () => {
    await setProviderQuirks(app, db, providerId, {
      fixedHeaders: { 'x-response-format': 'openai' },
      forwardedClientHeaders: ['x-response-format'],
    });
    upstream.reply(COMPLETION);

    await chat().set('x-response-format', 'wrapped').send(TEXT_REQUEST).expect(200);

    expect(upstream.lastRequest.headers['x-response-format']).toBe('openai');
  });
});
