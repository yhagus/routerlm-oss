import type { NestNodeApplication } from '@nestjs/platform-node';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { truncateTables } from '@tests/support/truncate';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const DEFAULT_WAIT = { seconds: 60, defaultSeconds: 60, isDefault: true, min: 1, max: 600 };

describe('Concurrency wait setting (e2e)', () => {
  let app: NestNodeApplication;
  let adaCookie: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  beforeEach(async () => {
    await truncateTables(app, sql.raw('settings'));
    await deleteAllUsers(app);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterAll(async () => {
    await app.close();
  });

  function waitRequest(method: 'get' | 'put' | 'delete') {
    return request(app.getHttpServer())
      [method]('/api/settings/concurrency-wait')
      .set('Cookie', adaCookie);
  }

  it('shows the default until a User changes it', async () => {
    const response = await waitRequest('get').expect(200);

    expect(response.body).toEqual(DEFAULT_WAIT);
  });

  it('saves a new wait and shows it afterwards', async () => {
    const saved = await waitRequest('put').send({ seconds: 120 }).expect(200);
    const shown = await waitRequest('get').expect(200);

    const expected = { ...DEFAULT_WAIT, seconds: 120, isDefault: false };
    expect(saved.body).toEqual(expected);
    expect(shown.body).toEqual(expected);
  });

  it('rejects a wait outside 1 to 600 seconds or not a whole number', async () => {
    await waitRequest('put').send({ seconds: 0 }).expect(400);
    await waitRequest('put').send({ seconds: 601 }).expect(400);
    await waitRequest('put').send({ seconds: 1.5 }).expect(400);
    await waitRequest('put').send({}).expect(400);

    expect((await waitRequest('get')).body).toEqual(DEFAULT_WAIT);
  });

  it('returns to the default when reset', async () => {
    await waitRequest('put').send({ seconds: 120 }).expect(200);

    const reset = await waitRequest('delete').expect(200);
    const shown = await waitRequest('get').expect(200);

    expect(reset.body).toEqual(DEFAULT_WAIT);
    expect(shown.body).toEqual(DEFAULT_WAIT);
  });
});
