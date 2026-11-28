import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import { CATALOG_DIRECTORY, loadCatalog } from '@/catalog/models/load-catalog';
import { allowPrivateUpstreams } from '@tests/support/private-upstreams';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

const CHAT_ENDPOINT = {
  kind: 'chat',
  protocol: 'openai-chat',
  baseUrl: 'https://api.acme.example/v1',
};

const PUBLIC_PROVIDER = {
  slug: 'acme',
  name: 'Acme AI',
  endpoints: [CHAT_ENDPOINT],
  authStyle: 'bearer',
};

const OAUTH_LOGIN = {
  flow: 'kimi-code',
  authHosts: { global: 'https://auth.acme.example', china: 'https://auth.acme.example.cn' },
  clientId: 'acme-cli',
  cliVersion: '1.0.0',
};

const OPENAI_CODEX_LOGIN = {
  flow: 'openai-codex',
  issuer: 'https://auth.acme.example',
  clientId: 'acme-cli',
  cliVersion: '1.0.0',
};

describe('Provider URL policy (e2e)', () => {
  let app: NestNodeApplication;
  let cookie: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  beforeEach(async () => {
    await allowPrivateUpstreams(app, false);
    await deleteAllUpstreamData(app);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  function createProvider(body: object) {
    return request(app.getHttpServer()).post('/api/providers').set('Cookie', cookie).send(body);
  }

  it('accepts a public https Provider', async () => {
    await createProvider({
      ...PUBLIC_PROVIDER,
      quirks: { quotaBaseUrl: 'https://quota.acme.example' },
      oauthLogin: OAUTH_LOGIN,
    }).expect(201);
  });

  it.each([
    ['plain http', 'http://api.acme.example/v1'],
    ['localhost', 'https://localhost/v1'],
    ['a loopback address', 'https://127.0.0.1/v1'],
    ['a private address', 'https://10.0.0.5/v1'],
    ['a private 172 address', 'https://172.20.1.1/v1'],
    ['a private 192.168 address', 'https://192.168.1.10/v1'],
    ['a link-local address', 'https://169.254.169.254/latest'],
    ['an IPv6 loopback', 'https://[::1]/v1'],
    ['an IPv4-mapped loopback', 'https://[::ffff:127.0.0.1]/v1'],
    ['an IPv6 unique-local address', 'https://[fd00::1]/v1'],
  ])('rejects a baseUrl with %s', async (_name, baseUrl) => {
    await createProvider({ ...PUBLIC_PROVIDER, endpoints: [{ ...CHAT_ENDPOINT, baseUrl }] }).expect(
      400,
    );
  });

  it('rejects a quotaBaseUrl, OAuth auth host and OAuth issuer that are not public https', async () => {
    await createProvider({
      ...PUBLIC_PROVIDER,
      quirks: { quotaBaseUrl: 'http://quota.acme.example' },
    }).expect(400);
    await createProvider({
      ...PUBLIC_PROVIDER,
      oauthLogin: {
        ...OAUTH_LOGIN,
        authHosts: { ...OAUTH_LOGIN.authHosts, china: 'https://10.0.0.1' },
      },
    }).expect(400);
    await createProvider({
      ...PUBLIC_PROVIDER,
      oauthLogin: { ...OPENAI_CODEX_LOGIN, issuer: 'http://auth.acme.example' },
    }).expect(400);
  });

  it("rejects changing an endpoint's baseUrl to a private one", async () => {
    const created = await createProvider(PUBLIC_PROVIDER).expect(201);

    await request(app.getHttpServer())
      .patch(`/api/providers/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ endpoints: [{ ...CHAT_ENDPOINT, baseUrl: 'https://192.168.1.10/v1' }] })
      .expect(400);
  });

  it('accepts the same URLs when the Setting allows private upstreams', async () => {
    await allowPrivateUpstreams(app, true);

    await createProvider({
      ...PUBLIC_PROVIDER,
      endpoints: [{ ...CHAT_ENDPOINT, baseUrl: 'http://192.168.1.10:11434/v1' }],
      quirks: { quotaBaseUrl: 'http://localhost:9000' },
    }).expect(201);
  });

  it('ships Catalog files that all pass the policy', async () => {
    await expect(loadCatalog(CATALOG_DIRECTORY)).resolves.not.toHaveLength(0);
  });
});
