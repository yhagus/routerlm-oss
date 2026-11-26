import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import { insertApiKey, insertOpenAiChatModel } from '@tests/support/inference';
import {
  addModelToGroup,
  allowApiKeyModelGroups,
  deleteModelGroup,
  insertModelGroup,
} from '@tests/support/model-groups';
import { deleteAllUpstreamData } from '@tests/support/upstream';
import { createTestApp } from '@tests/support/test-app';

describe('API Keys allowed whole Model Groups (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let smartModelId: string;
  let otherModelId: string;
  let fastGroupId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    ({ modelId: smartModelId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    ({ modelId: otherModelId } = await insertOpenAiChatModel(app, db, {
      modelName: 'other',
      baseUrl: upstream.baseUrl,
    }));
    fastGroupId = await insertModelGroup(app, db, 'fast', [smartModelId]);
    await insertModelGroup(app, db, 'everyday', [smartModelId]);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function keyAllowed(modelIds: string[], modelGroupIds: string[]): Promise<string> {
    const { key, id } = await insertApiKey(app, db, modelIds);
    await allowApiKeyModelGroups(app, db, id, modelGroupIds);
    return key;
  }

  function chat(apiKey: string, model: string) {
    upstream.reply({
      kind: 'json',
      status: 200,
      body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
    });
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ model, messages: [{ role: 'user', content: 'Hello' }] });
  }

  it('lets a key allowed only a group call its Models by bare name and under every slug', async () => {
    const apiKey = await keyAllowed([], [fastGroupId]);

    await chat(apiKey, 'smart').expect(200);
    await chat(apiKey, 'fast/smart').expect(200);
    await chat(apiKey, 'everyday/smart').expect(200);
  });

  it('refuses a Model outside the allowed group', async () => {
    const apiKey = await keyAllowed([], [fastGroupId]);

    const response = await chat(apiKey, 'other').expect(403);

    expect(response.body.error.code).toBe('model_not_allowed');
  });

  it('allows a Model added to the group after the key was made', async () => {
    const apiKey = await keyAllowed([], [fastGroupId]);
    await addModelToGroup(app, db, otherModelId, fastGroupId);

    await chat(apiKey, 'other').expect(200);
  });

  it('does not widen a key whose only allowed group was deleted', async () => {
    const lonelyGroupId = await insertModelGroup(app, db, 'lonely');
    const apiKey = await keyAllowed([], [lonelyGroupId]);
    await deleteModelGroup(app, db, lonelyGroupId);

    const response = await chat(apiKey, 'smart').expect(403);

    expect(response.body.error.code).toBe('model_not_allowed');
  });

  it('allows the union of the allowed Models and the allowed groups', async () => {
    const apiKey = await keyAllowed([otherModelId], [fastGroupId]);

    await chat(apiKey, 'smart').expect(200);
    await chat(apiKey, 'other').expect(200);
  });

  it('lists every slug form of the Models in an allowed group, and nothing else', async () => {
    const apiKey = await keyAllowed([], [fastGroupId]);

    const response = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    expect(response.body.data.map((model: { id: string }) => model.id)).toEqual([
      'everyday/smart',
      'fast/smart',
    ]);
  });
});
