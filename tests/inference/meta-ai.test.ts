import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';
import type { Database } from '@/db/schemas/relations';
import { FakeUpstream, openAiResponsesFixture } from '@tests/support/fake-upstream';
import {
  insertApiKey,
  insertOpenAiResponsesModel,
  setProviderQuirks,
  UPSTREAM_KEY,
} from '@tests/support/inference';
import { createTestApp } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };

describe('Inference from Meta AI (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let apiKey: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(app);
    const { providerId } = await insertOpenAiResponsesModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    });
    await setProviderQuirks(app, db, providerId, await catalogQuirks());
    ({ key: apiKey } = await insertApiKey(app, db));
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiResponsesFixture('upstream-response-tool-call.json')),
    });
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function catalogQuirks() {
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const provider = catalog.find((entry) => entry.slug === 'meta-ai');
    if (!provider) throw new Error('the Catalog has no Meta AI Provider');
    return provider.quirks;
  }

  it("answers a chat completion with the Provider's bearer key, asking for encrypted reasoning and the output limit", async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ ...TEXT_REQUEST, max_tokens: 64, temperature: 0.5 })
      .expect(200);

    const { headers, body, path } = upstream.lastRequest;
    expect(response.body.choices[0].message.content).toBe('Checking the weather.');
    expect(path).toBe('/v1/responses');
    expect(headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(body).toMatchObject({
      include: ['reasoning.encrypted_content'],
      max_output_tokens: 64,
      temperature: 0.5,
    });
  });
});
