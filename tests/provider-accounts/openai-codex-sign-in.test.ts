import { getQueueToken } from '@nestjs/bullmq';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts } from '@/db/schemas';
import { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';
import { FakeUpstream, type FakeReply, type ReceivedRequest } from '@tests/support/fake-upstream';
import {
  ACCOUNT_ID,
  accessToken,
  APPROVED_REPLY,
  AUTHORIZATION_CODE,
  CLI_VERSION,
  CLIENT_ID,
  CODE_VERIFIER,
  DEVICE_AUTH_ID,
  DEVICE_TOKEN_PATH,
  EMAIL,
  idToken,
  ISSUER_PATH,
  PENDING_REPLY,
  PLAN_TYPE,
  TOKEN_PATH,
  tokensReply,
  USER_CODE,
  USER_CODE_PATH,
  userCodeReply,
} from '@tests/support/openai-codex-oauth';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${((process.pid + 7) % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { OAUTH_SIGN_INS_QUEUE } = await import('@/queue/models/queue-names');

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const POLL_INTERVAL = '0.1';
const WAIT_TIMEOUT_MS = 5_000;
const WAIT_STEP_MS = 25;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const HOUR_SECONDS = 3600;
const ACCESS_TOKEN = accessToken('granted', HOUR_SECONDS);
const REFRESH_TOKEN = 'codex-refresh-token-0123';
const ID_TOKEN = idToken({ email: EMAIL });

type SignIn = {
  id: string;
  status: 'pending' | 'completed' | 'denied' | 'expired';
  providerAccount?: { id: string; name: string };
};

describe('Signing in to OpenAI Codex as the Codex CLI (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let pollQueue: Queue;
  let openAi: FakeUpstream;
  let cookie: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    pollQueue = app.get<Queue>(getQueueToken(OAUTH_SIGN_INS_QUEUE));
    await pollQueue.obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    openAi = await FakeUpstream.start();
  });

  beforeEach(async () => {
    await pollQueue.obliterate({ force: true });
    openAi.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    const provider = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({
        slug: 'openai-codex',
        name: 'OpenAI Codex',
        endpoints: [{ kind: 'chat', protocol: 'openai-responses', baseUrl: openAi.baseUrl }],
        authStyle: 'bearer',
        credentialKinds: ['oauth-login'],
        oauthLogin: {
          flow: 'openai-codex',
          issuer: `${openAi.origin}${ISSUER_PATH}`,
          clientId: CLIENT_ID,
          cliVersion: CLI_VERSION,
        },
      })
      .expect(201);
    providerId = provider.body.id;
  });

  afterAll(async () => {
    await worker.close();
    await pollQueue.obliterate({ force: true });
    await app.close();
    await openAi.close();
  });

  function openAiAnswers(...polls: FakeReply[]): void {
    openAi.replyTo(USER_CODE_PATH, userCodeReply(POLL_INTERVAL));
    for (const poll of polls) {
      openAi.replyTo(DEVICE_TOKEN_PATH, poll);
    }
  }

  function startSignIn(body: object = { providerId }) {
    return request(app.getHttpServer())
      .post('/api/provider-accounts/sign-ins')
      .set('Cookie', cookie)
      .send(body);
  }

  async function readSignIn(signInId: string): Promise<SignIn> {
    const response = await request(app.getHttpServer())
      .get(`/api/provider-accounts/sign-ins/${signInId}`)
      .set('Cookie', cookie)
      .expect(200);
    return response.body;
  }

  async function endedSignIn(signInId: string): Promise<SignIn> {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const signIn = await readSignIn(signInId);
      if (signIn.status !== 'pending') return signIn;
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }
    throw new Error('Timed out waiting for the sign-in to end');
  }

  function requestsTo(path: string): ReceivedRequest[] {
    return openAi.requests.filter((received) => received.path === path);
  }

  async function approvedSignIn(body?: object): Promise<SignIn> {
    openAiAnswers(APPROVED_REPLY);
    openAi.replyTo(
      TOKEN_PATH,
      tokensReply({ accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN, idToken: ID_TOKEN }),
    );
    const started = await startSignIn(body).expect(201);
    return endedSignIn(started.body.id);
  }

  it("starts a sign-in with the user code and OpenAI's device page, asking for no region", async () => {
    openAiAnswers();
    const startedAt = Date.now();

    const started = await startSignIn().expect(201);

    expect(started.body).toEqual({
      id: expect.any(String),
      status: 'pending',
      userCode: USER_CODE,
      verificationUri: `${openAi.origin}${ISSUER_PATH}/codex/device`,
      verificationUriComplete: null,
      expiresAt: expect.any(String),
    });
    const expiresInMs = new Date(started.body.expiresAt).getTime() - startedAt;
    expect(expiresInMs).toBeGreaterThan(FIFTEEN_MINUTES_MS - 5_000);
    expect(expiresInMs).toBeLessThan(FIFTEEN_MINUTES_MS + 5_000);
    expect(started.text).not.toContain(DEVICE_AUTH_ID);
    const [userCodeRequest] = openAi.requests;
    expect(userCodeRequest.path).toBe(USER_CODE_PATH);
    expect(userCodeRequest.body).toEqual({ client_id: CLIENT_ID });
    expect(userCodeRequest.headers).toMatchObject({
      originator: 'codex_cli_rs',
      'user-agent': expect.stringMatching(new RegExp(`^codex_cli_rs/${CLI_VERSION} \\(.+; .+\\)$`)),
    });
  });

  it('stays pending while OpenAI answers the poll with 403 or 404', async () => {
    openAiAnswers(PENDING_REPLY, { kind: 'json', status: 404, body: {} }, PENDING_REPLY);

    const started = await startSignIn().expect(201);
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (requestsTo(DEVICE_TOKEN_PATH).length < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }

    expect(requestsTo(DEVICE_TOKEN_PATH)[0].body).toEqual({
      device_auth_id: DEVICE_AUTH_ID,
      user_code: USER_CODE,
    });
    expect(requestsTo(DEVICE_TOKEN_PATH)).toHaveLength(3);
    expect(await readSignIn(started.body.id)).toMatchObject({ status: 'pending' });
  });

  it('exchanges the approved code and creates a Provider Account named from email and plan', async () => {
    const signIn = await approvedSignIn();

    expect(signIn).toEqual({
      id: expect.any(String),
      status: 'completed',
      providerAccount: expect.objectContaining({
        providerId,
        name: `${EMAIL} (${PLAN_TYPE})`,
        credentialKind: 'oauth-login',
        oauthRegion: null,
        oauthEmail: EMAIL,
        oauthPlanType: PLAN_TYPE,
        isEnabled: true,
      }),
    });
    const [exchange] = requestsTo(TOKEN_PATH);
    expect(exchange.headers['content-type']).toContain('application/x-www-form-urlencoded');
    expect(exchange.body).toEqual({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: AUTHORIZATION_CODE,
      redirect_uri: `${openAi.origin}${ISSUER_PATH}/deviceauth/callback`,
      code_verifier: CODE_VERIFIER,
    });
    expect(JSON.stringify(signIn)).not.toMatch(/token|chatgpt-account/i);
  });

  it('stores every token as ciphertext, with the account id, email and plan from the id_token', async () => {
    const signIn = await approvedSignIn();

    const [stored] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.id, signIn.providerAccount?.id ?? ''));
    const keyCipher = app.get(ProviderKeyCipher);
    expect(keyCipher.decrypt(stored.oauthEncryptedAccessToken ?? '')).toBe(ACCESS_TOKEN);
    expect(keyCipher.decrypt(stored.oauthEncryptedRefreshToken ?? '')).toBe(REFRESH_TOKEN);
    expect(keyCipher.decrypt(stored.oauthEncryptedIdToken ?? '')).toBe(ID_TOKEN);
    expect(stored).toMatchObject({
      oauthAccountId: ACCOUNT_ID,
      oauthEmail: EMAIL,
      oauthPlanType: PLAN_TYPE,
    });
    const lifetimeMs = (stored.oauthExpiresAt?.getTime() ?? 0) - Date.now();
    expect(lifetimeMs).toBeGreaterThan((HOUR_SECONDS - 30) * 1000);
    expect(lifetimeMs).toBeLessThanOrEqual(HOUR_SECONDS * 1000);
  });

  it('reads the email from the profile claim when the id_token has none at the top', async () => {
    openAiAnswers(APPROVED_REPLY);
    openAi.replyTo(
      TOKEN_PATH,
      tokensReply({
        accessToken: ACCESS_TOKEN,
        refreshToken: REFRESH_TOKEN,
        idToken: idToken({ profileEmail: 'grace@example.com', planType: 'plus' }),
      }),
    );
    const started = await startSignIn().expect(201);

    const signIn = await endedSignIn(started.body.id);

    expect(signIn.providerAccount?.name).toBe('grace@example.com (plus)');
  });

  it('reports a sign-in the User denied, and creates no Provider Account', async () => {
    openAiAnswers({ kind: 'json', status: 400, body: { error: 'access_denied' } });
    const started = await startSignIn().expect(201);

    expect(await endedSignIn(started.body.id)).toEqual({ id: started.body.id, status: 'denied' });
    expect(await db.select().from(providerAccounts)).toEqual([]);
  });

  it("ends the sign-in when the approved code can't be exchanged, and creates no Provider Account", async () => {
    openAiAnswers(APPROVED_REPLY);
    openAi.replyTo(TOKEN_PATH, { kind: 'json', status: 400, body: { error: 'invalid_grant' } });
    const started = await startSignIn().expect(201);

    expect(await endedSignIn(started.body.id)).toMatchObject({ status: 'denied' });
    expect(await db.select().from(providerAccounts)).toEqual([]);
  });

  it('answers 502 saying device login is off when OpenAI answers the user code request with 404', async () => {
    openAi.replyTo(USER_CODE_PATH, { kind: 'json', status: 404, body: {} });

    const refused = await startSignIn().expect(502);

    expect(refused.body.message).toMatch(/device code login turned off/);
  });

  it('signs in again on an account, replacing its login and keeping its name and priority', async () => {
    const first = await approvedSignIn();
    const accountId = first.providerAccount?.id ?? '';
    await request(app.getHttpServer())
      .patch(`/api/provider-accounts/${accountId}`)
      .set('Cookie', cookie)
      .send({ name: 'Team plan', priority: 7 })
      .expect(200);
    await db
      .update(providerAccounts)
      .set({ isEnabled: false, disabledReason: 'Sign in again' })
      .where(eq(providerAccounts.id, accountId));
    const renewedAccessToken = accessToken('signed in again', HOUR_SECONDS);
    openAiAnswers(APPROVED_REPLY);
    openAi.replyTo(
      TOKEN_PATH,
      tokensReply({
        accessToken: renewedAccessToken,
        refreshToken: 'refresh-token-2',
        idToken: idToken({ accountId: 'chatgpt-account-2', email: EMAIL }),
      }),
    );

    const started = await startSignIn({ providerId, providerAccountId: accountId }).expect(201);
    const signIn = await endedSignIn(started.body.id);

    expect(signIn.providerAccount).toMatchObject({
      id: accountId,
      name: 'Team plan',
      priority: 7,
      isEnabled: true,
      disabledReason: null,
    });
    const stored = await db.select().from(providerAccounts);
    expect(stored).toHaveLength(1);
    expect(app.get(ProviderKeyCipher).decrypt(stored[0].oauthEncryptedAccessToken ?? '')).toBe(
      renewedAccessToken,
    );
    expect(stored[0].oauthAccountId).toBe('chatgpt-account-2');
  });
});
