import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';

const FIRST_USER = { email: 'ada@example.com', password: 'correct horse battery' };

describe('Authentication: sessions (e2e)', () => {
  let app: NestNodeApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUsers(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('logout ends the session', async () => {
    const server = app.getHttpServer();
    const cookie = await setUpFirstUser(app, FIRST_USER);

    await request(server).post('/api/auth/logout').set('Cookie', cookie).expect(204);

    await request(server).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('refuses dashboard calls without a session', async () => {
    await setUpFirstUser(app, FIRST_USER);

    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/users').expect(401);
  });
});
