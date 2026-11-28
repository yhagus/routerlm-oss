import type * as Crypto from 'node:crypto';
import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

vi.mock('node:crypto', async (importOriginal) => {
  const crypto = await importOriginal<typeof Crypto>();
  return {
    ...crypto,
    randomInt: (minOrMax: number, max?: number): number => (max === undefined ? 0 : minOrMax),
  };
});

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };
const PROVIDER_ACCOUNT_KEY = 'sk-acme-0123456789abcdefWXYZ';
const ALWAYS_GENERATED_NAME = 'Andromeda Antlia';

describe('Provider Account names generated while the name is taken (e2e)', () => {
  let app: NestNodeApplication;
  let cookie: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(app);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProvider(slug: string): Promise<string> {
    const provider = await request(app.getHttpServer())
      .post('/api/providers')
      .set('Cookie', cookie)
      .send({
        slug,
        name: `${slug} AI`,
        endpoints: [
          { kind: 'chat', protocol: 'openai-chat', baseUrl: `https://api.${slug}.example/v1` },
        ],
        authStyle: 'bearer',
      })
      .expect(201);
    return provider.body.id;
  }

  async function createUnnamedAccount(providerId: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/provider-accounts')
      .set('Cookie', cookie)
      .send({ providerId, key: PROVIDER_ACCOUNT_KEY })
      .expect(201);
    return created.body.name;
  }

  it("numbers the name, from 2, when every generated name is taken by the Provider's accounts", async () => {
    const providerId = await createProvider('acme');

    const names = [
      await createUnnamedAccount(providerId),
      await createUnnamedAccount(providerId),
      await createUnnamedAccount(providerId),
    ];

    expect(names).toEqual([
      ALWAYS_GENERATED_NAME,
      `${ALWAYS_GENERATED_NAME} 2`,
      `${ALWAYS_GENERATED_NAME} 3`,
    ]);
  });
});
