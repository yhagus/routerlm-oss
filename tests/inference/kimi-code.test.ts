import { readFileSync } from 'node:fs';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';
import type { CatalogProviderQuirks } from '@/catalog/schemas/catalog.schema';
import type { Database } from '@/db/schemas/relations';
import { upstreamModels } from '@/db/schemas';
import { type FakeReply, FakeUpstream } from '@tests/support/fake-upstream';
import {
  addProviderAccount,
  insertApiKey,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_KEY,
} from '@tests/support/inference';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const BACKUP_KEY = 'sk-backup-secret-9876543210';
const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };
const GATEWAY_VERSION: unknown = JSON.parse(readFileSync('./package.json', 'utf8')).version;

const COMPLETION: FakeReply = {
  kind: 'json',
  status: 200,
  body: {
    id: 'chatcmpl-kimi-1',
    object: 'chat.completion',
    model: 'k3',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello.', reasoning_content: 'A greeting.' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 8, cached_tokens: 0 },
  },
};

const COMPLETION_STREAM: FakeReply = {
  kind: 'stream',
  events: [
    { choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'A greeting.' } }] },
    { choices: [{ index: 0, delta: { content: 'Hello.' } }] },
    {
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
          usage: { prompt_tokens: 12, completion_tokens: 8, cached_tokens: 0 },
        },
      ],
    },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .concat('data: [DONE]\n\n')
    .join(''),
};

function quotaExceeded(body: unknown): FakeReply {
  return { kind: 'json', status: 429, body };
}

const RATE_LIMITED: FakeReply = {
  kind: 'json',
  status: 429,
  body: { error: { type: 'rate_limit_reached_error', message: 'Too many requests' } },
};

describe('Inference from Kimi Code with an API key (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let kimiCodeQuirks: CatalogProviderQuirks;
  let apiKey: string;
  let cookie: string;
  let providerId: string;
  let primaryAccountId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
    const catalog = await loadCatalog(CATALOG_DIRECTORY);
    const kimiCode = catalog.find((provider) => provider.slug === 'kimi-code');
    if (!kimiCode) throw new Error('the Catalog has no Kimi Code Provider');
    kimiCodeQuirks = kimiCode.quirks;
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(app);
    cookie = await setUpFirstUser(app, OPERATOR);
    const inserted = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    });
    ({ providerId, providerAccountId: primaryAccountId } = inserted);
    await serveUpstreamModel('k3');
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  async function serveUpstreamModel(upstreamModelId: string): Promise<void> {
    await db
      .update(upstreamModels)
      .set({ upstreamModelId })
      .where(eq(upstreamModels.providerId, providerId));
    await setProviderQuirks(app, db, providerId, kimiCodeQuirks);
  }

  function chat(body: object = TEXT_REQUEST) {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(body);
  }

  async function listedPrimaryAccount(): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get('/api/provider-accounts')
      .set('Cookie', cookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === primaryAccountId);
  }

  function attemptedKeys(): string[] {
    return upstream.requests.map((received) =>
      String(received.headers.authorization).replace('Bearer ', ''),
    );
  }

  it.each([
    ['none', 'low'],
    ['minimal', 'low'],
    ['low', 'low'],
    ['medium', 'high'],
    ['high', 'high'],
    ['xhigh', 'max'],
  ])('sends the effort %s as thinking effort %s', async (effort, kimiEffort) => {
    upstream.reply(COMPLETION);

    await chat({ ...TEXT_REQUEST, reasoning_effort: effort }).expect(200);

    expect(upstream.lastRequest.body).toEqual({
      model: 'k3',
      messages: [{ role: 'user', content: 'Hi' }],
      thinking: { type: 'enabled', effort: kimiEffort },
    });
  });

  it("keeps thinking enabled, with Kimi's default effort, when the client sets no effort", async () => {
    upstream.reply(COMPLETION);

    await chat().expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ thinking: { type: 'enabled' } });
    expect(upstream.lastRequest.body).not.toHaveProperty('thinking.effort');
  });

  it('sends no effort to an Upstream Model that accepts none', async () => {
    await serveUpstreamModel('kimi-for-coding-highspeed');
    upstream.reply(COMPLETION);

    await chat({ ...TEXT_REQUEST, reasoning_effort: 'high' }).expect(200);

    expect(upstream.lastRequest.body).toEqual({
      model: 'kimi-for-coding-highspeed',
      messages: [{ role: 'user', content: 'Hi' }],
      thinking: { type: 'enabled' },
    });
  });

  it('sends the output cap as max_completion_tokens', async () => {
    upstream.reply(COMPLETION);

    await chat({ ...TEXT_REQUEST, max_tokens: 512 }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ max_completion_tokens: 512 });
    expect(upstream.lastRequest.body).not.toHaveProperty('max_tokens');
  });

  it("passes on the client's prompt_cache_key", async () => {
    upstream.reply(COMPLETION);

    await chat({ ...TEXT_REQUEST, prompt_cache_key: 'session-42' }).expect(200);

    expect(upstream.lastRequest.body).toMatchObject({ prompt_cache_key: 'session-42' });
  });

  it('identifies itself as routerlm, with no Kimi CLI identity headers', async () => {
    upstream.reply(COMPLETION);

    await chat().expect(200);

    const { headers } = upstream.lastRequest;
    expect(headers['user-agent']).toBe(`routerlm/${String(GATEWAY_VERSION)}`);
    expect(Object.keys(headers).filter((name) => name.startsWith('x-msh-'))).toEqual([]);
  });

  it("answers a Chat Completions client with Kimi's thinking as reasoning_content", async () => {
    upstream.reply(COMPLETION);

    const response = await chat().expect(200);

    expect(response.body.choices[0].message).toMatchObject({
      content: 'Hello.',
      reasoning_content: 'A greeting.',
    });
  });

  it("streams Kimi's thinking to a Messages client as a thinking block", async () => {
    upstream.reply(COMPLETION_STREAM);

    const response = await request(app.getHttpServer())
      .post('/v1/messages')
      .set('x-api-key', apiKey)
      .send({ ...TEXT_REQUEST, max_tokens: 256, stream: true })
      .expect(200);

    expect(response.text).toContain('"delta":{"type":"thinking_delta","thinking":"A greeting."}');
    expect(response.text).toContain('"delta":{"type":"text_delta","text":"Hello."}');
  });

  it.each<[string, unknown]>([
    ['code', { error: { code: 'exceeded_current_quota_error', message: 'Quota used up' } }],
    ['type', { error: { type: 'exceeded_current_quota_error', message: 'Quota used up' } }],
    [
      'nested type',
      { error: { message: 'Quota used up', error: { type: 'exceeded_current_quota_error' } } },
    ],
  ])(
    'marks the Provider Account Exhausted and falls back after a 429 with exceeded_current_quota_error as %s',
    async (_place, body) => {
      await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
      upstream.reply(quotaExceeded(body));
      upstream.reply(COMPLETION);

      await chat().expect(200);

      expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
      expect(await listedPrimaryAccount()).toMatchObject({ cooldownCause: 'exhausted' });
    },
  );

  it('starts a Cooldown, not Exhausted, after any other 429', async () => {
    await addProviderAccount(app, db, providerId, { key: BACKUP_KEY, priority: 1 });
    upstream.reply(RATE_LIMITED);
    upstream.reply(COMPLETION);

    await chat().expect(200);

    expect(attemptedKeys()).toEqual([UPSTREAM_KEY, BACKUP_KEY]);
    expect(await listedPrimaryAccount()).toMatchObject({ cooldownCause: 'rate_limited' });
  });
});
