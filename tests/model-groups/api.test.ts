import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import type { Database } from '@/db/schemas/relations';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const OPERATOR = { email: 'ops@example.com', password: 'ops password' };

describe('Model Groups (e2e)', () => {
  let app: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeAll(async () => {
    ({ app, db } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(db);
    cookie = await setUpFirstUser(app, OPERATOR);
  });

  afterAll(async () => {
    await app.close();
  });

  function dashboard() {
    return request(app.getHttpServer());
  }

  async function createModelGroup(name: string, slug: string): Promise<string> {
    const created = await dashboard()
      .post('/api/model-groups')
      .set('Cookie', cookie)
      .send({ name, slug })
      .expect(201);
    return created.body.id;
  }

  async function createModel(name: string, groupIds: string[]): Promise<string> {
    const created = await dashboard()
      .post('/api/models')
      .set('Cookie', cookie)
      .send({ name, groupIds })
      .expect(201);
    return created.body.id;
  }

  it('lists each Model Group with how many Models it has', async () => {
    const fast = await createModelGroup('Fast', 'fast');
    await createModelGroup('Coding Plans', 'coding-plans');
    await createModel('smart', [fast]);

    const list = await dashboard().get('/api/model-groups').set('Cookie', cookie).expect(200);

    expect(list.body).toEqual([
      expect.objectContaining({ name: 'Coding Plans', slug: 'coding-plans', modelCount: 0 }),
      expect.objectContaining({ id: fast, name: 'Fast', slug: 'fast', modelCount: 1 }),
    ]);
  });

  it('renames a Model Group and changes its slug', async () => {
    const groupId = await createModelGroup('Fast', 'fast');

    const updated = await dashboard()
      .patch(`/api/model-groups/${groupId}`)
      .set('Cookie', cookie)
      .send({ name: 'Quick', slug: 'quick' })
      .expect(200);

    expect(updated.body).toEqual(expect.objectContaining({ name: 'Quick', slug: 'quick' }));
  });

  it('refuses a slug that is not lowercase words joined by single hyphens', async () => {
    const refused = await dashboard()
      .post('/api/model-groups')
      .set('Cookie', cookie)
      .send({ name: 'Fast', slug: 'Fast--Lane' })
      .expect(400);

    expect(refused.body.message).toEqual([expect.stringContaining('slug')]);
  });

  it('refuses a second Model Group with the same slug, saying why', async () => {
    await createModelGroup('Fast', 'fast');

    const refused = await dashboard()
      .post('/api/model-groups')
      .set('Cookie', cookie)
      .send({ name: 'Also fast', slug: 'fast' })
      .expect(409);

    expect(refused.body.message).toBe('A Model Group with the slug "fast" already exists');
  });

  it('deletes a Model Group whose Models all keep another group', async () => {
    const fast = await createModelGroup('Fast', 'fast');
    const everyday = await createModelGroup('Everyday', 'everyday');
    const modelId = await createModel('smart', [fast, everyday]);

    await dashboard().delete(`/api/model-groups/${fast}`).set('Cookie', cookie).expect(204);

    const model = await dashboard().get(`/api/models/${modelId}`).set('Cookie', cookie).expect(200);
    expect(model.body.groups).toEqual([{ id: everyday, name: 'Everyday', slug: 'everyday' }]);
  });

  it('refuses to delete the only Model Group of a Model, naming the Models', async () => {
    const fast = await createModelGroup('Fast', 'fast');
    const everyday = await createModelGroup('Everyday', 'everyday');
    await createModel('smart', [fast]);
    await createModel('coder', [fast]);
    await createModel('vision', [fast, everyday]);

    const refused = await dashboard()
      .delete(`/api/model-groups/${fast}`)
      .set('Cookie', cookie)
      .expect(409);

    expect(refused.body.message).toBe(
      'This Model Group is the only group of these Models: coder, smart. Add them to another group first.',
    );
  });

  it('refuses to list Model Groups without a signed-in User', async () => {
    await dashboard().get('/api/model-groups').expect(401);
  });
});
