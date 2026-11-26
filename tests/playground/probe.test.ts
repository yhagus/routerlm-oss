import { randomUUID } from 'node:crypto';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts, providers, upstreamModels } from '@/db/schemas';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import { type FakeReply, FakeUpstream, openAiChatFixture } from '@tests/support/fake-upstream';
import {
  addProviderAccount,
  insertApiKey,
  insertDashScopeVideoModel,
  insertOpenAiChatModel,
  setProviderQuirks,
  UPSTREAM_KEY,
  UPSTREAM_MODEL_ID,
} from '@tests/support/inference';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

vi.hoisted(() => {
  process.env.PROBE_TIMEOUT_MS = '500';
});

const ADA = { email: 'ada@example.com', password: "ada's password" };
const BACKUP_KEY = 'sk-backup-secret-9876543210';
const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };

const SUCCESS: FakeReply = {
  kind: 'json',
  status: 200,
  body: JSON.parse(openAiChatFixture('upstream-response-tool-call.json')),
};
const SERVER_ERROR: FakeReply = { kind: 'json', status: 503, body: { error: 'overloaded' } };
const UNAUTHORIZED: FakeReply = { kind: 'json', status: 401, body: { error: 'bad key' } };
const FORBIDDEN: FakeReply = { kind: 'json', status: 403, body: { error: 'forbidden' } };
const PLAN_LIMIT_REACHED: FakeReply = {
  kind: 'json',
  status: 400,
  body: { base_resp: { status_code: 2067, status_msg: 'plan limit reached' } },
};

function chatAnswer(message: Record<string, unknown>): FakeReply {
  return {
    kind: 'json',
    status: 200,
    body: {
      id: 'chatcmpl-probe',
      object: 'chat.completion',
      model: UPSTREAM_MODEL_ID,
      choices: [{ index: 0, message, finish_reason: 'length' }],
      usage: { prompt_tokens: 12, completion_tokens: 16 },
    },
  };
}

interface ListedProviderAccount {
  id: string;
  isEnabled: boolean;
  cooldownCause: string | null;
  cooldownEndsAt: string | null;
}

describe('Probe of an Upstream Model (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let upstream: FakeUpstream;
  let adaCookie: string;
  let providerId: string;
  let mainAccountId: string;
  let backupAccountId: string;
  let upstreamModelRowId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    upstream = await FakeUpstream.start();
  });

  beforeEach(async () => {
    upstream.reset();
    await deleteAllUpstreamData(db);
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
    ({ providerId, providerAccountId: mainAccountId } = await insertOpenAiChatModel(app, db, {
      modelName: 'smart',
      baseUrl: upstream.baseUrl,
    }));
    backupAccountId = await addProviderAccount(app, db, providerId, {
      key: BACKUP_KEY,
      priority: 1,
    });
    [{ id: upstreamModelRowId }] = await db.select({ id: upstreamModels.id }).from(upstreamModels);
  });

  afterAll(async () => {
    await upstream.close();
    await app.close();
  });

  function probe(upstreamModelId = upstreamModelRowId) {
    return request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelId}/probe`)
      .set('Cookie', adaCookie);
  }

  async function listedAccount(providerAccountId: string): Promise<ListedProviderAccount> {
    const listed = await request(app.getHttpServer())
      .get('/api/provider-accounts')
      .set('Cookie', adaCookie)
      .expect(200);
    return listed.body.find((account: { id: string }) => account.id === providerAccountId);
  }

  async function changeInDatabase(change: () => Promise<unknown>): Promise<void> {
    await change();
    await app.get(SnapshotService).changed();
  }

  it('calls the Upstream Model once with each enabled Provider Account and answers one result each', async () => {
    await changeInDatabase(() =>
      db.update(upstreamModels).set({ inputPrice: 1, outputPrice: 1, cacheReadPrice: 1 }),
    );
    upstream.replyWithCredential(UPSTREAM_KEY, SUCCESS);
    upstream.replyWithCredential(BACKUP_KEY, SERVER_ERROR);

    const response = await probe().expect(200);

    expect(response.body).toEqual({
      results: [
        {
          providerAccountId: mainAccountId,
          providerAccountName: 'main',
          ok: true,
          latencyMs: expect.any(Number),
          upstreamStatus: 200,
          failureReason: null,
          errorOrigin: null,
          errorMessage: null,
          errorCaptureId: null,
          cost: 0.00016,
        },
        {
          providerAccountId: backupAccountId,
          providerAccountName: 'account 1',
          ok: false,
          latencyMs: expect.any(Number),
          upstreamStatus: 503,
          failureReason: 'server_error',
          errorOrigin: 'upstream',
          errorMessage: '{"error":"overloaded"}',
          errorCaptureId: expect.any(String),
          cost: null,
        },
      ],
    });
  });

  it('sends a short fixed chat request that asks for a few tokens, low reasoning and no stream', async () => {
    upstream.reply(SUCCESS);
    upstream.reply(SUCCESS);

    await probe().expect(200);

    expect(upstream.lastRequest.body).toMatchObject({
      model: UPSTREAM_MODEL_ID,
      messages: [{ role: 'user' }],
      max_tokens: 16,
      reasoning_effort: 'low',
    });
    expect(upstream.lastRequest.body).not.toHaveProperty('stream', true);
    expect(upstream.lastRequest.body).not.toHaveProperty('service_tier');
  });

  it('asks an Upstream Model without the reasoning capability for no reasoning', async () => {
    await changeInDatabase(() => db.update(upstreamModels).set({ capabilities: ['tools'] }));
    upstream.reply(SUCCESS);
    upstream.reply(SUCCESS);

    await probe().expect(200);

    expect(upstream.lastRequest.body).not.toHaveProperty('reasoning_effort');
  });

  it('counts a well-formed answer as a success whatever its content: empty, or reasoning only', async () => {
    upstream.replyWithCredential(UPSTREAM_KEY, chatAnswer({ role: 'assistant', content: '' }));
    upstream.replyWithCredential(
      BACKUP_KEY,
      chatAnswer({ role: 'assistant', content: null, reasoning_content: 'The user wants OK.' }),
    );

    const response = await probe().expect(200);

    expect(response.body.results).toMatchObject([
      { providerAccountId: mainAccountId, ok: true, upstreamStatus: 200 },
      { providerAccountId: backupAccountId, ok: true, upstreamStatus: 200 },
    ]);
  });

  it('skips a disabled Provider Account', async () => {
    await changeInDatabase(() =>
      db
        .update(providerAccounts)
        .set({ isEnabled: false })
        .where(eq(providerAccounts.id, backupAccountId)),
    );
    upstream.reply(SUCCESS);

    const response = await probe().expect(200);

    expect(response.body.results).toEqual([
      expect.objectContaining({ providerAccountId: mainAccountId, ok: true }),
    ]);
    expect(upstream.requests).toHaveLength(1);
  });

  it('probes a disabled Upstream Model of a disabled Provider', async () => {
    await changeInDatabase(async () => {
      await db.update(upstreamModels).set({ isEnabled: false });
      await db.update(providers).set({ isEnabled: false });
    });
    upstream.reply(SUCCESS);
    upstream.reply(SUCCESS);

    const response = await probe().expect(200);

    expect(response.body.results.map((result: { ok: boolean }) => result.ok)).toEqual([true, true]);
  });

  it('refuses an unknown Upstream Model', async () => {
    const response = await probe(randomUUID()).expect(404);

    expect(response.body).toMatchObject({ error: { code: 'model_not_found' } });
    expect(upstream.requests).toEqual([]);
  });

  it('refuses a video Upstream Model', async () => {
    await deleteAllUpstreamData(db);
    adaCookie = await setUpFirstUser(app, ADA);
    await insertDashScopeVideoModel(app, db, {
      modelName: 'director',
      baseUrl: `${upstream.origin}/api/v1`,
    });
    const [video] = await db.select({ id: upstreamModels.id }).from(upstreamModels);

    const response = await probe(video.id).expect(400);

    expect(response.body).toMatchObject({ error: { code: 'invalid_request' } });
    expect(upstream.requests).toEqual([]);
  });

  it('refuses a Terms Risk Provider while terms-risk Providers are not allowed', async () => {
    await changeInDatabase(() => db.update(providers).set({ termsRisk: true }));

    const response = await probe().expect(400);

    expect(response.body).toMatchObject({ error: { code: 'invalid_request' } });
    expect(upstream.requests).toEqual([]);
  });

  it('refuses a Provider with no enabled Provider Account', async () => {
    await changeInDatabase(() => db.update(providerAccounts).set({ isEnabled: false }));

    const response = await probe().expect(400);

    expect(response.body).toMatchObject({ error: { code: 'invalid_request' } });
    expect(upstream.requests).toEqual([]);
  });

  it('probes an account in Cooldown and changes no Cooldown, whether the probe succeeds or fails', async () => {
    const { key: apiKey } = await insertApiKey(app, db);
    upstream.replyWithCredential(UPSTREAM_KEY, SERVER_ERROR);
    upstream.replyWithCredential(BACKUP_KEY, SUCCESS);
    await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(TEXT_REQUEST)
      .expect(200);
    const { cooldownEndsAt } = await listedAccount(mainAccountId);
    expect(cooldownEndsAt).not.toBeNull();
    upstream.replyWithCredential(UPSTREAM_KEY, SUCCESS);
    upstream.replyWithCredential(BACKUP_KEY, SERVER_ERROR);

    const response = await probe().expect(200);

    expect(response.body.results.map((result: { ok: boolean }) => result.ok)).toEqual([
      true,
      false,
    ]);
    expect(await listedAccount(mainAccountId)).toMatchObject({ cooldownEndsAt });
    expect(await listedAccount(backupAccountId)).toMatchObject({ cooldownEndsAt: null });
  });

  it('disables no account on a 401 or on repeated 403s', async () => {
    upstream.replyWithCredential(UPSTREAM_KEY, UNAUTHORIZED);
    upstream.replyWithCredential(UPSTREAM_KEY, UNAUTHORIZED);
    upstream.replyWithCredential(UPSTREAM_KEY, UNAUTHORIZED);
    upstream.replyWithCredential(BACKUP_KEY, FORBIDDEN);
    upstream.replyWithCredential(BACKUP_KEY, FORBIDDEN);
    upstream.replyWithCredential(BACKUP_KEY, FORBIDDEN);

    await probe().expect(200);
    await probe().expect(200);
    await probe().expect(200);

    expect(await listedAccount(mainAccountId)).toMatchObject({
      isEnabled: true,
      cooldownEndsAt: null,
    });
    expect(await listedAccount(backupAccountId)).toMatchObject({
      isEnabled: true,
      cooldownEndsAt: null,
    });
  });

  it('marks no account Exhausted on an exhaustion refusal', async () => {
    await setProviderQuirks(app, db, providerId, { exhaustedErrorCodes: [2067] });
    upstream.replyWithCredential(UPSTREAM_KEY, PLAN_LIMIT_REACHED);
    upstream.replyWithCredential(BACKUP_KEY, SUCCESS);

    const response = await probe().expect(200);

    expect(response.body.results[0]).toMatchObject({ ok: false, failureReason: 'exhausted' });
    expect(await listedAccount(mainAccountId)).toMatchObject({
      cooldownCause: null,
      cooldownEndsAt: null,
    });
  });

  it("reports an account that doesn't answer in time as failed", async () => {
    upstream.replyWithCredential(UPSTREAM_KEY, SUCCESS);
    upstream.replyWithCredential(BACKUP_KEY, { kind: 'hang' });

    const response = await probe().expect(200);

    expect(response.body.results[1]).toMatchObject({
      ok: false,
      upstreamStatus: null,
      failureReason: 'timeout',
      errorOrigin: 'upstream',
    });
  });

  it('is only for signed-in Users', async () => {
    await request(app.getHttpServer())
      .post(`/api/playground/upstream-models/${upstreamModelRowId}/probe`)
      .expect(401);
  });
});
