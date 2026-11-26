import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import {
  type FakeReply,
  FakeUpstream,
  openAiResponsesFixture,
  type ReceivedRequest,
} from '@tests/support/fake-upstream';
import { insertApiKey, insertOpenAiResponsesModel, UPSTREAM_KEY } from '@tests/support/inference';
import {
  ACCOUNT_ID,
  accessToken,
  addCodexLoginAccount,
  CLI_VERSION,
  CLIENT_ID,
  EMAIL,
  idToken,
  jwtWith,
  offerCodexOauthLogin,
  PLAN_TYPE,
  TOKEN_PATH,
  tokensReply,
} from '@tests/support/openai-codex-oauth';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const TEXT_REQUEST = { model: 'smart', messages: [{ role: 'user', content: 'Hi' }] };
const RESPONSES_PATH = '/v1/responses';
const HOUR_SECONDS = 3600;
const SHORT_LIFETIME_SECONDS = 60;
const REFRESH_TOKEN = 'codex-refresh-token-0123';

const RESPONSE: FakeReply = {
  kind: 'json',
  status: 200,
  body: JSON.parse(openAiResponsesFixture('upstream-response-tool-call.json')),
};

const UNAUTHORIZED: FakeReply = {
  kind: 'json',
  status: 401,
  body: { error: { message: 'Your authentication token has expired', code: 'token_expired' } },
};

describe('Inference from an OpenAI Codex OAuth Login (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let openAi: FakeUpstream;
  let apiKey: string;
  let cookie: string;
  let providerId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
    openAi = await FakeUpstream.start();
  });

  beforeEach(async () => {
    openAi.reset();
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    ({ providerId } = await insertOpenAiResponsesModel(app, db, {
      modelName: 'smart',
      baseUrl: openAi.baseUrl,
    }));
    await offerCodexOauthLogin(db, providerId, openAi.origin);
    ({ key: apiKey } = await insertApiKey(app, db));
  });

  afterAll(async () => {
    await openAi.close();
    await app.close();
  });

  function chat() {
    return request(app.getHttpServer())
      .post('/v1/chat/completions')
      .set('Authorization', `Bearer ${apiKey}`)
      .send(TEXT_REQUEST);
  }

  async function listedAccount(providerAccountId: string): Promise<Record<string, unknown>> {
    const list = await request(app.getHttpServer())
      .get('/api/provider-accounts')
      .set('Cookie', cookie)
      .expect(200);
    return list.body.find((account: { id: string }) => account.id === providerAccountId);
  }

  function responsesCalls(): ReceivedRequest[] {
    return openAi.requests.filter((received) => received.path === RESPONSES_PATH);
  }

  function attemptedCredentials(): string[] {
    return responsesCalls().map((received) =>
      String(received.headers.authorization).replace('Bearer ', ''),
    );
  }

  function refreshes(): ReceivedRequest[] {
    return openAi.requests.filter((received) => received.path === TOKEN_PATH);
  }

  it('serves as the Codex CLI with the account id and a fresh session id per request', async () => {
    const granted = accessToken('granted', HOUR_SECONDS);
    await addCodexLoginAccount(app, db, providerId, {
      accessToken: granted,
      refreshToken: REFRESH_TOKEN,
    });
    openAi.reply(RESPONSE);
    openAi.reply(RESPONSE);

    await chat().expect(200);
    await chat().expect(200);

    const [first, second] = responsesCalls();
    expect(first.headers).toMatchObject({
      authorization: `Bearer ${granted}`,
      'chatgpt-account-id': ACCOUNT_ID,
      originator: 'codex_cli_rs',
      'user-agent': expect.stringMatching(new RegExp(`^codex_cli_rs/${CLI_VERSION} \\(.+; .+\\)$`)),
      version: CLI_VERSION,
      'session-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(second.headers['session-id']).not.toBe(first.headers['session-id']);
    expect(first.headers).not.toHaveProperty('thread-id');
  });

  it("refreshes with a JSON body when the access token's exp is near, and stores the rotated tokens", async () => {
    await addCodexLoginAccount(app, db, providerId, {
      accessToken: accessToken('near its end', SHORT_LIFETIME_SECONDS),
      refreshToken: REFRESH_TOKEN,
    });
    const renewed = accessToken('renewed', SHORT_LIFETIME_SECONDS);
    const renewedAgain = accessToken('renewed again', HOUR_SECONDS);
    openAi.replyTo(
      TOKEN_PATH,
      tokensReply({
        accessToken: renewed,
        refreshToken: 'refresh-token-2',
        idToken: idToken({ accountId: 'chatgpt-account-2' }),
      }),
    );
    openAi.replyTo(TOKEN_PATH, tokensReply({ accessToken: renewedAgain }));
    openAi.reply(RESPONSE);
    openAi.reply(RESPONSE);
    openAi.reply(RESPONSE);

    await chat().expect(200);
    await chat().expect(200);
    await chat().expect(200);

    const [first, second] = refreshes();
    expect(first.headers['content-type']).toContain('application/json');
    expect(first.body).toEqual({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: REFRESH_TOKEN,
    });
    expect(second.body).toMatchObject({ refresh_token: 'refresh-token-2' });
    expect(refreshes()).toHaveLength(2);
    expect(attemptedCredentials()).toEqual([renewed, renewedAgain, renewedAgain]);
    expect(responsesCalls().map((call) => call.headers['chatgpt-account-id'])).toEqual([
      'chatgpt-account-2',
      'chatgpt-account-2',
      'chatgpt-account-2',
    ]);
  });

  it('keeps the stored account id, email and plan when a refreshed id_token names none', async () => {
    const accountId = await addCodexLoginAccount(app, db, providerId, {
      accessToken: accessToken('near its end', SHORT_LIFETIME_SECONDS),
      refreshToken: REFRESH_TOKEN,
    });
    openAi.replyTo(
      TOKEN_PATH,
      tokensReply({ accessToken: accessToken('renewed', HOUR_SECONDS), idToken: jwtWith({}) }),
    );
    openAi.reply(RESPONSE);

    await chat().expect(200);
    openAi.reply(RESPONSE);
    await chat().expect(200);

    expect(responsesCalls().map((call) => call.headers['chatgpt-account-id'])).toEqual([
      ACCOUNT_ID,
      ACCOUNT_ID,
    ]);
    expect(await listedAccount(accountId)).toMatchObject({
      oauthEmail: EMAIL,
      plan: PLAN_TYPE,
    });
  });

  it('refreshes once and tries again when Codex answers an Attempt with 401', async () => {
    const granted = accessToken('granted', HOUR_SECONDS);
    const accountId = await addCodexLoginAccount(app, db, providerId, {
      accessToken: granted,
      refreshToken: REFRESH_TOKEN,
    });
    const renewed = accessToken('renewed', HOUR_SECONDS);
    openAi.reply(UNAUTHORIZED);
    openAi.replyTo(TOKEN_PATH, tokensReply({ accessToken: renewed, refreshToken: 'refresh-2' }));
    openAi.reply(RESPONSE);

    await chat().expect(200);

    expect(refreshes()).toHaveLength(1);
    expect(attemptedCredentials()).toEqual([granted, renewed]);
    expect(await listedAccount(accountId)).toMatchObject({ isEnabled: true, disabledReason: null });
  });

  it.each([
    ['401', { kind: 'json', status: 401, body: {} }],
    ['invalid_grant', { kind: 'json', status: 400, body: { error: 'invalid_grant' } }],
    [
      'refresh_token_reused',
      {
        kind: 'json',
        status: 400,
        body: { error: { code: 'refresh_token_reused', message: 'Already used' } },
      },
    ],
    [
      'refresh_token_expired',
      { kind: 'json', status: 400, body: { error: 'refresh_token_expired' } },
    ],
    [
      'refresh_token_invalidated',
      { kind: 'json', status: 400, body: { error: 'refresh_token_invalidated' } },
    ],
  ] satisfies [string, FakeReply][])(
    'disables the account with a sign-in-again reason when the refresh is refused with %s',
    async (_refusal, reply) => {
      const accountId = await addCodexLoginAccount(app, db, providerId, {
        accessToken: accessToken('near its end', SHORT_LIFETIME_SECONDS),
        refreshToken: REFRESH_TOKEN,
      });
      openAi.replyTo(TOKEN_PATH, reply);
      openAi.reply(RESPONSE);

      await chat().expect(200);

      expect(attemptedCredentials()).toEqual([UPSTREAM_KEY]);
      await vi.waitFor(async () =>
        expect(await listedAccount(accountId)).toMatchObject({
          isEnabled: false,
          disabledReason: expect.stringMatching(/^Sign in again/),
        }),
      );
    },
  );

  it('keeps the account enabled when the refresh fails for now, and serves while the token lasts', async () => {
    const stillGood = accessToken('still good', SHORT_LIFETIME_SECONDS);
    const accountId = await addCodexLoginAccount(app, db, providerId, {
      accessToken: stillGood,
      refreshToken: REFRESH_TOKEN,
    });
    const unavailable: FakeReply = { kind: 'json', status: 503, body: {} };
    openAi.replyTo(TOKEN_PATH, unavailable);
    openAi.replyTo(TOKEN_PATH, { kind: 'json', status: 429, body: {} });
    openAi.replyTo(TOKEN_PATH, unavailable);
    openAi.reply(RESPONSE);

    await chat().expect(200);

    expect(refreshes()).toHaveLength(3);
    expect(attemptedCredentials()).toEqual([stillGood]);
    expect(await listedAccount(accountId)).toMatchObject({ isEnabled: true, disabledReason: null });
  });
});
