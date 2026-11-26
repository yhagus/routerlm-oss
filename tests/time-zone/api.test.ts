import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';

const ADA = { email: 'ada@example.com', password: "ada's password" };

describe('Server time zone API (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let adaCookie: string;
  const originalTimeZone = process.env.TZ;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUsers(db);
    adaCookie = await setUpFirstUser(app, ADA);
  });

  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  afterAll(async () => {
    await app.close();
  });

  it('names the time zone the server runs in', async () => {
    process.env.TZ = 'Asia/Jakarta';

    const response = await request(app.getHttpServer())
      .get('/api/time-zone')
      .set('Cookie', adaCookie)
      .expect(200);

    expect(response.body).toEqual({ timeZone: 'Asia/Jakarta' });
  });

  it("follows a change of the server's time zone", async () => {
    process.env.TZ = 'America/New_York';
    const first = await request(app.getHttpServer()).get('/api/time-zone').set('Cookie', adaCookie);

    process.env.TZ = 'UTC';
    const second = await request(app.getHttpServer())
      .get('/api/time-zone')
      .set('Cookie', adaCookie);

    expect([first.body.timeZone, second.body.timeZone]).toEqual(['America/New_York', 'UTC']);
  });

  it('needs a signed-in User', async () => {
    await request(app.getHttpServer()).get('/api/time-zone').expect(401);
  });
});
