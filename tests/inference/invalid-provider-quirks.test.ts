import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { providers } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { type FakeReply, FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import { insertApiKey, insertOpenAiChatModel } from '@tests/support/inference';
import { createTestApp } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const SUCCESS: FakeReply = {
  kind: 'json',
  status: 200,
  body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
};

describe('Stored Provider quirks that no longer validate (e2e)', () => {
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
    await deleteAllUpstreamData(db);
    const { providerId } = await insertOpenAiChatModel(app, db, {
      modelName: 'broken',
      baseUrl: upstream.baseUrl,
    });
    await insertOpenAiChatModel(app, db, { modelName: 'healthy', baseUrl: upstream.baseUrl });
    await db
      .update(providers)
      .set({ quirks: { cacheMarkerLimit: -1 } })
      .where(eq(providers.id, providerId));
    await app.get(SnapshotService).changed();
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function chat(model: string) {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ model, messages: [{ role: 'user', content: 'Hi' }] });
  }

  it('fails the requests that use that Provider, without calling the upstream', async () => {
    upstream.reply(SUCCESS);

    await chat('broken').expect(500);

    expect(upstream.requests).toHaveLength(0);
  });

  it('still serves the other Providers', async () => {
    upstream.reply(SUCCESS);

    await chat('healthy').expect(200);
  });
});
