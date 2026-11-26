import { randomUUID } from 'node:crypto';
import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { models } from '@/db/schemas';
import { insertModelGroup } from '@tests/support/model-groups';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

describe('Models in Model Groups (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;
  let everyday: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
    everyday = await insertModelGroup(app, db, 'everyday');
  });

  afterAll(async () => {
    await app.close();
  });

  function createModel(body: object) {
    return request(app.getHttpServer()).post('/api/models').set('Cookie', cookie).send(body);
  }

  it('returns the Model Groups a new Model joins', async () => {
    const created = await createModel({ name: 'smart', groupIds: [everyday] }).expect(201);

    expect(created.body.groups).toEqual([
      { id: everyday, name: 'everyday group', slug: 'everyday' },
    ]);
  });

  it('refuses a Model without a Model Group', async () => {
    await createModel({ name: 'smart', groupIds: [] }).expect(400);
  });

  it('refuses a Model Group that does not exist', async () => {
    const refused = await createModel({ name: 'smart', groupIds: [randomUUID()] }).expect(404);

    expect(refused.body.message).toBe('Model Group not found');
  });

  it('refuses a Model name containing a slash', async () => {
    const refused = await createModel({ name: 'everyday/smart', groupIds: [everyday] }).expect(400);

    expect(refused.body.message).toEqual([expect.stringContaining('cannot contain "/"')]);
  });

  it('moves a Model to the Model Groups it is given', async () => {
    const created = await createModel({ name: 'smart', groupIds: [everyday] }).expect(201);
    const fast = await insertModelGroup(app, db, 'fast');

    const updated = await request(app.getHttpServer())
      .patch(`/api/models/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ groupIds: [fast] })
      .expect(200);

    expect(updated.body.groups).toEqual([{ id: fast, name: 'fast group', slug: 'fast' }]);
  });

  it('lists a Model from before Model Groups with no groups', async () => {
    await db.insert(models).values({ name: 'legacy' });

    const list = await request(app.getHttpServer())
      .get('/api/models')
      .set('Cookie', cookie)
      .expect(200);

    expect(list.body).toEqual([expect.objectContaining({ name: 'legacy', groups: [] })]);
  });
});
