import type { NestNodeApplication } from '@nestjs/platform-node';
import request from 'supertest';
import { createTestApp } from '@tests/support/test-app';

function unknownRouteBody(path: string): Record<string, unknown> {
  return { statusCode: 404, error: 'Not Found', message: `Cannot GET ${path}` };
}

describe('BACKEND_ROLE (e2e)', () => {
  describe('inference', () => {
    let app: NestNodeApplication;

    beforeAll(async () => {
      ({ app } = await createTestApp(undefined, { role: 'inference' }));
    });

    afterAll(async () => {
      await app?.close();
    });

    it('serves the inference endpoints and /health', async () => {
      await request(app.getHttpServer()).get('/v1/models').expect(401);
      await request(app.getHttpServer()).get('/health').expect(200);
    });

    it('answers the dashboard API, the control plane and / like an unknown route', async () => {
      const dashboard = await request(app.getHttpServer()).get('/api/api-keys').expect(404);
      const controlPlane = await request(app.getHttpServer())
        .get('/integration/v1/keys')
        .expect(404);
      const root = await request(app.getHttpServer()).get('/').expect(404);

      expect(dashboard.body).toEqual(unknownRouteBody('/api/api-keys'));
      expect(controlPlane.body).toEqual(unknownRouteBody('/integration/v1/keys'));
      expect(root.body).toEqual(unknownRouteBody('/'));
    });
  });

  describe('admin', () => {
    let app: NestNodeApplication;

    beforeAll(async () => {
      ({ app } = await createTestApp(undefined, { role: 'admin' }));
    });

    afterAll(async () => {
      await app?.close();
    });

    it('serves the dashboard API, the control plane and /health', async () => {
      await request(app.getHttpServer()).get('/api/api-keys').expect(401);
      await request(app.getHttpServer()).get('/integration/v1/keys').expect(401);
      await request(app.getHttpServer()).get('/health').expect(200);
    });

    it('answers the inference endpoints and / like an unknown route', async () => {
      const inference = await request(app.getHttpServer()).get('/v1/models').expect(404);
      const root = await request(app.getHttpServer()).get('/').expect(404);

      expect(inference.body).toEqual(unknownRouteBody('/v1/models'));
      expect(root.body).toEqual(unknownRouteBody('/'));
    });
  });

  describe('all', () => {
    let app: NestNodeApplication;

    beforeAll(async () => {
      ({ app } = await createTestApp(undefined, { role: 'all' }));
    });

    afterAll(async () => {
      await app?.close();
    });

    it('serves inference, the dashboard API, the control plane, /health and /', async () => {
      await request(app.getHttpServer()).get('/v1/models').expect(401);
      await request(app.getHttpServer()).get('/api/api-keys').expect(401);
      await request(app.getHttpServer()).get('/integration/v1/keys').expect(401);
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/').expect(200);
    });
  });
});
