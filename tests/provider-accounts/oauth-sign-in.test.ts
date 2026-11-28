import { getQueueToken } from '@nestjs/bullmq';
import { CommandBus } from '@nestjs/cqrs';
import type { NestNodeApplication } from '@nestjs/platform-node';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { providerAccounts } from '@/db/schemas';
import { PollOauthSignInCommand } from '@/upstream/commands/impl/poll-oauth-sign-in.command';
import { CONSTELLATIONS } from '@/upstream/models/constellation-name';
import { ProviderKeyCipher } from '@/upstream/providers/provider-key-cipher';
import { FakeUpstream, type ReceivedRequest } from '@tests/support/fake-upstream';
import {
  ACCESS_TOKEN,
  DEVICE_AUTHORIZATION_PATH,
  DEVICE_CODE,
  deviceAuthorizationReply,
  grantedTokensReply,
  PROFILE_PATH,
  profileReply,
  REFRESH_TOKEN,
  refreshedTokensReply,
  TOKEN_PATH,
  tokenErrorReply,
  USER_CODE,
} from '@tests/support/kimi-oauth';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = `/${(process.pid % 15) + 1}`;
process.env.REDIS_URL = redisUrl.toString();
const { createTestApp, setUpFirstUser } = await import('@tests/support/test-app');
const { WorkerModule } = await import('@/worker.module');
const { OAUTH_SIGN_INS_QUEUE } = await import('@/queue/models/queue-names');

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const CLIENT_ID = 'client-id-of-the-cli';
const CLI_VERSION = '9.8.7';
const POLL_INTERVAL_SECONDS = 0.1;
const LONG_ENOUGH_SECONDS = 60;
const WAIT_TIMEOUT_MS = 5_000;
const WAIT_STEP_MS = 25;
const GRANT_DELAY_MS = 500;
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

type SignIn = {
  id: string;
  status: 'pending' | 'completed' | 'denied' | 'expired';
  providerAccount?: { id: string; name: string };
};

describe('Signing in to a Provider for an OAuth Login (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let worker: TestingModule;
  let pollQueue: Queue;
  let authHost: FakeUpstream;
  let cookie: string;
  let providerId: string;
  let testNumber = 0;
  let globalAuthHost: string;
  let chinaAuthHost: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    pollQueue = app.get<Queue>(getQueueToken(OAUTH_SIGN_INS_QUEUE));
    await pollQueue.obliterate({ force: true });
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    authHost = await FakeUpstream.start();
  });

  beforeEach(async () => {
    authHost.reset();
    await deleteAllUpstreamData(app, worker);
    cookie = await setUpFirstUser(app, OPERATOR);
    testNumber += 1;
    globalAuthHost = `${authHost.origin}/global-${testNumber}`;
    chinaAuthHost = `${authHost.origin}/china-${testNumber}`;
    providerId = await createProvider({
      slug: 'kimi-code',
      oauthLogin: {
        flow: 'kimi-code',
        authHosts: { global: globalAuthHost, china: chinaAuthHost },
        clientId: CLIENT_ID,
        cliVersion: CLI_VERSION,
      },
    });
  });

  afterAll(async () => {
    await worker.close();
    await pollQueue.obliterate({ force: true });
    await app.close();
    await authHost.close();
  });

  async function createProvider(fields: { slug: string; oauthLogin?: object }): Promise<string> {
    const provider = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({
        name: 'Kimi Code',
        endpoints: [{ kind: 'chat', protocol: 'openai-chat', baseUrl: authHost.baseUrl }],
        authStyle: 'bearer',
        ...fields,
      })
      .expect(201);
    return provider.body.id;
  }

  const globalPath = (path: string) => `/global-${testNumber}${path}`;

  function authHostAnswers(
    timing: { expiresIn: number; interval?: number },
    ...polls: ReturnType<typeof tokenErrorReply>[]
  ): void {
    authHost.replyTo(globalPath(DEVICE_AUTHORIZATION_PATH), deviceAuthorizationReply(timing));
    for (const poll of polls) {
      authHost.replyTo(globalPath(TOKEN_PATH), poll);
    }
  }

  function startSignIn(body: object = { providerId, region: 'global' }) {
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

  async function until<Value>(read: () => Promise<Value | undefined>, what: string) {
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const value = await read();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  function endedSignIn(signInId: string): Promise<SignIn> {
    return until(async () => {
      const signIn = await readSignIn(signInId);
      return signIn.status === 'pending' ? undefined : signIn;
    }, 'the sign-in to end');
  }

  function pollsReceived(): ReceivedRequest[] {
    return authHost.requests.filter((received) => received.path === globalPath(TOKEN_PATH));
  }

  function untilPolled(count: number): Promise<ReceivedRequest[]> {
    return until(
      async () => (pollsReceived().length >= count ? pollsReceived() : undefined),
      `${count} polls`,
    );
  }

  async function completedSignIn(): Promise<SignIn> {
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS },
      grantedTokensReply(),
    );
    const started = await startSignIn().expect(201);
    return endedSignIn(started.body.id);
  }

  it('starts a sign-in with the user code and the link to the verification page', async () => {
    authHostAnswers({ expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS });
    const startedAt = Date.now();

    const started = await startSignIn().expect(201);

    expect(started.body).toEqual({
      id: expect.any(String),
      status: 'pending',
      userCode: USER_CODE,
      verificationUri: 'https://www.kimi.com/code/authorize',
      verificationUriComplete: `https://www.kimi.com/code/authorize?user_code=${USER_CODE}`,
      expiresAt: expect.any(String),
    });
    const expiresInMs = new Date(started.body.expiresAt).getTime() - startedAt;
    expect(expiresInMs).toBeGreaterThan((LONG_ENOUGH_SECONDS - 1) * 1000);
    expect(expiresInMs).toBeLessThan((LONG_ENOUGH_SECONDS + 5) * 1000);
    expect(started.text).not.toContain(DEVICE_CODE);
    const [authorization] = authHost.requests;
    expect(authorization.method).toBe('POST');
    expect(authorization.body).toEqual({ client_id: CLIENT_ID });
  });

  it('signs in at the auth host of the region the operator chose', async () => {
    authHost.replyTo(
      `/china-${testNumber}${DEVICE_AUTHORIZATION_PATH}`,
      deviceAuthorizationReply({ expiresIn: LONG_ENOUGH_SECONDS }),
    );

    await startSignIn({ providerId, region: 'china' }).expect(201);

    expect(authHost.lastRequest.path).toBe(`/china-${testNumber}${DEVICE_AUTHORIZATION_PATH}`);
  });

  it('stays pending and keeps polling while the User has not approved', async () => {
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS },
      tokenErrorReply('authorization_pending'),
      tokenErrorReply('authorization_pending'),
      tokenErrorReply('authorization_pending'),
    );

    const started = await startSignIn().expect(201);
    const polls = await untilPolled(3);

    expect(polls[0].body).toEqual({
      client_id: CLIENT_ID,
      device_code: DEVICE_CODE,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    expect(await readSignIn(started.body.id)).toMatchObject({
      status: 'pending',
      userCode: USER_CODE,
    });
  });

  it('polls further apart once the auth host says to slow down', async () => {
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS },
      tokenErrorReply('slow_down'),
      grantedTokensReply(),
    );
    const started = await startSignIn().expect(201);
    await untilPolled(1);

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_SECONDS * 10 * 1000));

    expect(pollsReceived()).toHaveLength(1);
    expect(await readSignIn(started.body.id)).toMatchObject({ status: 'pending' });
  });

  it('creates a Provider Account holding the OAuth Login once the User approves', async () => {
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS },
      tokenErrorReply('authorization_pending'),
      grantedTokensReply(),
    );
    authHost.replyTo(
      PROFILE_PATH,
      profileReply({ nickname: 'Ada', user_level_name: 'Allegretto' }),
    );
    const server = app.getHttpServer();

    const started = await startSignIn().expect(201);
    const signIn = await endedSignIn(started.body.id);
    const list = await request(server)
      .get('/api/provider-accounts')
      .set('Cookie', cookie)
      .expect(200);

    expect(signIn).toEqual({
      id: started.body.id,
      status: 'completed',
      providerAccount: expect.objectContaining({
        providerId,
        name: 'Ada (Allegretto)',
        credentialKind: 'oauth-login',
        oauthRegion: 'global',
        keyLastFour: null,
        isEnabled: true,
      }),
    });
    expect(list.body).toEqual([
      expect.objectContaining({ id: signIn.providerAccount?.id, credentialKind: 'oauth-login' }),
    ]);
    const responseText = JSON.stringify(signIn) + list.text;
    expect(responseText).not.toContain(ACCESS_TOKEN);
    expect(responseText).not.toContain(REFRESH_TOKEN);
    expect(Object.keys(list.body[0]).filter((field) => /token|device/i.test(field))).toEqual([]);
  });

  it('creates one Provider Account when two polls of the same sign-in are granted at once', async () => {
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: LONG_ENOUGH_SECONDS },
      grantedTokensReply(GRANT_DELAY_MS),
      grantedTokensReply(),
    );
    const started = await startSignIn().expect(201);
    const commandBus = app.get(CommandBus);

    await Promise.all([
      commandBus.execute(new PollOauthSignInCommand(started.body.id)),
      commandBus.execute(new PollOauthSignInCommand(started.body.id)),
    ]);

    const accounts = await db.select().from(providerAccounts);
    expect(accounts).toHaveLength(1);
    const signIn = await readSignIn(started.body.id);
    expect(signIn).toEqual({
      id: started.body.id,
      status: 'completed',
      providerAccount: expect.objectContaining({ id: accounts[0].id }),
    });
  });

  it("stores the OAuth Login's tokens as ciphertext, with their expiry and a device id", async () => {
    authHost.replyTo(PROFILE_PATH, profileReply({ nickname: 'Ada' }));
    const grantedAfter = Date.now();

    const signIn = await completedSignIn();

    const [stored] = await db
      .select()
      .from(providerAccounts)
      .where(eq(providerAccounts.id, signIn.providerAccount?.id ?? ''));
    const keyCipher = app.get(ProviderKeyCipher);
    expect(stored.encryptedKey).toBeNull();
    expect(stored.oauthEncryptedAccessToken).not.toContain(ACCESS_TOKEN);
    expect(stored.oauthEncryptedRefreshToken).not.toContain(REFRESH_TOKEN);
    expect(keyCipher.decrypt(stored.oauthEncryptedAccessToken ?? '')).toBe(ACCESS_TOKEN);
    expect(keyCipher.decrypt(stored.oauthEncryptedRefreshToken ?? '')).toBe(REFRESH_TOKEN);
    const lifetimeMs = (stored.oauthExpiresAt?.getTime() ?? 0) - grantedAfter;
    expect(lifetimeMs).toBeGreaterThan(895_000);
    expect(lifetimeMs).toBeLessThan(905_000);
    expect(stored.oauthDeviceId).toBe(pollsReceived()[0].headers['x-msh-device-id']);
  });

  it("presents itself to the auth host as the Provider's CLI", async () => {
    authHost.replyTo(PROFILE_PATH, profileReply({ nickname: 'Ada' }));

    await completedSignIn();

    const [authorization] = authHost.requests;
    const [poll] = pollsReceived();
    const identity = {
      'user-agent': `kimi-code-cli/${CLI_VERSION}`,
      'x-msh-platform': 'kimi_code_cli',
      'x-msh-version': CLI_VERSION,
      'x-msh-device-id': expect.stringMatching(/^[0-9a-f]{32}$/),
      'x-msh-device-name': 'routerlm',
      'x-msh-device-model': expect.stringMatching(/\S/),
      'x-msh-os-version': expect.stringMatching(/\S/),
    };
    expect(authorization.headers).toMatchObject(identity);
    expect(poll.headers).toMatchObject(identity);
    expect(poll.headers['x-msh-device-id']).toBe(authorization.headers['x-msh-device-id']);
  });

  it('reads the profile with the access token and no CLI identity', async () => {
    authHost.replyTo(PROFILE_PATH, profileReply({ nickname: 'Ada' }));

    await completedSignIn();

    const profileRequest = authHost.requests.find((received) => received.path === PROFILE_PATH);
    expect(profileRequest?.method).toBe('GET');
    expect(profileRequest?.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(profileRequest?.headers['user-agent']).not.toContain('kimi-code-cli');
    const identityHeaders = Object.keys(profileRequest?.headers ?? {}).filter((name) =>
      name.startsWith('x-msh-'),
    );
    expect(identityHeaders).toEqual([]);
  });

  it('names the Provider Account after the email when the profile has no nickname', async () => {
    authHost.replyTo(PROFILE_PATH, profileReply({ email: 'ada@example.com' }));

    const signIn = await completedSignIn();

    expect(signIn.providerAccount?.name).toBe('ada@example.com');
  });

  it("gives the Provider Account a generated name when the profile can't be read", async () => {
    authHost.replyTo(PROFILE_PATH, { kind: 'json', status: 500, body: {} });

    const signIn = await completedSignIn();

    const [first, second] = (signIn.providerAccount?.name ?? '').split(' ');
    expect(CONSTELLATIONS).toContain(first);
    expect(CONSTELLATIONS).toContain(second);
  });

  it('lets the operator rename the Provider Account, but not give it a key', async () => {
    authHost.replyTo(PROFILE_PATH, profileReply({ nickname: 'Ada' }));
    const signIn = await completedSignIn();
    const account = `/api/provider-accounts/${signIn.providerAccount?.id}`;
    const server = app.getHttpServer();

    const renamed = await request(server)
      .patch(account)
      .set('Cookie', cookie)
      .send({ name: 'Team plan' })
      .expect(200);
    await request(server)
      .patch(account)
      .set('Cookie', cookie)
      .send({ key: 'sk-kimi-0123456789abcdef' })
      .expect(409);

    expect(renamed.body).toMatchObject({ name: 'Team plan', credentialKind: 'oauth-login' });
  });

  it('reports a sign-in the User denied, and creates no Provider Account', async () => {
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS },
      tokenErrorReply('access_denied'),
    );

    const started = await startSignIn().expect(201);
    const signIn = await endedSignIn(started.body.id);

    expect(signIn).toEqual({ id: started.body.id, status: 'denied' });
    expect(await db.select().from(providerAccounts)).toEqual([]);
  });

  it("ends the sign-in at once when the granted OAuth Login can't be kept, and creates no Provider Account", async () => {
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS },
      grantedTokensReply(GRANT_DELAY_MS),
    );

    const started = await startSignIn().expect(201);
    await untilPolled(1);
    await request(app.getHttpServer())
      .delete(`/api/providers/${providerId}`)
      .set('Cookie', cookie)
      .expect(204);
    const signIn = await endedSignIn(started.body.id);

    expect(signIn).toEqual({ id: started.body.id, status: 'denied' });
    expect(await db.select().from(providerAccounts)).toEqual([]);
  });

  it('reports a sign-in whose code the auth host says has expired', async () => {
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS },
      tokenErrorReply('expired_token'),
    );

    const started = await startSignIn().expect(201);
    const signIn = await endedSignIn(started.body.id);

    expect(signIn).toEqual({ id: started.body.id, status: 'expired' });
  });

  it('lets a sign-in nobody approves expire on its own, and stops polling', async () => {
    authHostAnswers(
      { expiresIn: 0.3, interval: POLL_INTERVAL_SECONDS },
      tokenErrorReply('authorization_pending'),
    );

    const started = await startSignIn().expect(201);
    const signIn = await endedSignIn(started.body.id);
    const pollsAtExpiry = pollsReceived().length;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_SECONDS * 5 * 1000));

    expect(signIn).toEqual({ id: started.body.id, status: 'expired' });
    expect(pollsReceived().length).toBeLessThanOrEqual(pollsAtExpiry + 1);
  });

  it('uses the 5 second interval of the device-code grant when the auth host names none', async () => {
    authHostAnswers({ expiresIn: LONG_ENOUGH_SECONDS }, grantedTokensReply());

    await startSignIn().expect(201);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_SECONDS * 10 * 1000));

    expect(pollsReceived()).toEqual([]);
  });

  it('signs in again on a disabled Provider Account, replacing its login and keeping the rest', async () => {
    authHost.replyTo(PROFILE_PATH, profileReply({ nickname: 'Ada' }));
    const first = await completedSignIn();
    const accountId = first.providerAccount?.id ?? '';
    await request(app.getHttpServer())
      .patch(`/api/provider-accounts/${accountId}`)
      .set('Cookie', cookie)
      .send({ name: 'Team plan', priority: 7 })
      .expect(200);
    const [disabled] = await db
      .update(providerAccounts)
      .set({ isEnabled: false, disabledReason: 'Sign in again' })
      .where(eq(providerAccounts.id, accountId))
      .returning({ deviceId: providerAccounts.oauthDeviceId });
    authHostAnswers(
      { expiresIn: LONG_ENOUGH_SECONDS, interval: POLL_INTERVAL_SECONDS },
      refreshedTokensReply({
        accessToken: 'access-token-2',
        refreshToken: 'refresh-token-2',
        expiresIn: 900,
      }),
    );

    const started = await startSignIn({
      providerId,
      region: 'global',
      providerAccountId: accountId,
    }).expect(201);
    const signIn = await endedSignIn(started.body.id);

    expect(signIn).toEqual({
      id: started.body.id,
      status: 'completed',
      providerAccount: expect.objectContaining({
        id: accountId,
        name: 'Team plan',
        priority: 7,
        isEnabled: true,
        disabledReason: null,
      }),
    });
    const stored = await db.select().from(providerAccounts);
    expect(stored).toHaveLength(1);
    const keyCipher = app.get(ProviderKeyCipher);
    expect(keyCipher.decrypt(stored[0].oauthEncryptedAccessToken ?? '')).toBe('access-token-2');
    expect(keyCipher.decrypt(stored[0].oauthEncryptedRefreshToken ?? '')).toBe('refresh-token-2');
    expect(stored[0].oauthDeviceId).toBe(disabled.deviceId);
    const signInAgainCalls = authHost.requests.slice(-2);
    expect(signInAgainCalls.map((call) => call.headers['x-msh-device-id'])).toEqual([
      disabled.deviceId,
      disabled.deviceId,
    ]);
    expect(authHost.requests.filter((call) => call.path === PROFILE_PATH)).toHaveLength(1);
  });

  it('refuses to sign in again on a Provider Account that is unknown, of another Provider, or holds an API key', async () => {
    authHost.replyTo(PROFILE_PATH, profileReply({ nickname: 'Ada' }));
    const signIn = await completedSignIn();
    const otherProviderId = await createProvider({
      slug: 'other',
      oauthLogin: {
        flow: 'kimi-code',
        authHosts: { global: globalAuthHost, china: chinaAuthHost },
        clientId: CLIENT_ID,
        cliVersion: CLI_VERSION,
      },
    });
    const apiKeyAccount = await request(app.getHttpServer())
      .post('/api/provider-accounts')
      .set('Cookie', cookie)
      .send({ providerId, name: 'with a key', key: 'sk-kimi-0123456789abcdef' })
      .expect(201);
    authHost.reset();

    const signInAgain = (providerAccountId: string, ofProviderId = providerId) =>
      startSignIn({ providerId: ofProviderId, region: 'global', providerAccountId });
    await signInAgain(UNKNOWN_ID).expect(404);
    await signInAgain(signIn.providerAccount?.id ?? '', otherProviderId).expect(404);
    await signInAgain(apiKeyAccount.body.id).expect(409);

    expect(authHost.requests).toEqual([]);
  });

  it('refuses a sign-in to a Provider that offers no OAuth Login', async () => {
    const apiKeyOnlyProviderId = await createProvider({ slug: 'acme' });

    const refused = await startSignIn({ providerId: apiKeyOnlyProviderId, region: 'global' });

    expect(refused.status).toBe(409);
    expect(authHost.requests).toEqual([]);
  });

  it('refuses a sign-in for an unknown Provider, an unknown region, or without a session', async () => {
    await startSignIn({ providerId: UNKNOWN_ID, region: 'global' }).expect(404);
    await startSignIn({ providerId, region: 'mars' }).expect(400);
    await request(app.getHttpServer())
      .post('/api/provider-accounts/sign-ins')
      .send({ providerId, region: 'global' })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/provider-accounts/sign-ins/${UNKNOWN_ID}`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('answers 502 when the auth host starts no sign-in', async () => {
    authHost.replyTo(globalPath(DEVICE_AUTHORIZATION_PATH), {
      kind: 'json',
      status: 503,
      body: { error: 'temporarily_unavailable' },
    });

    await startSignIn().expect(502);
  });
});
