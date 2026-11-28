import type { NestNodeApplication } from '@nestjs/platform-node';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { vi } from 'vitest';
import { upstreamModels } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import { RedisConnection } from '@/redis/providers/redis-connection';
import { httpControlPlaneClient } from '@tests/support/control-plane-client';
import { insertApiKey, insertOpenAiChatModel } from '@tests/support/inference';
import { createIntegration } from '@tests/support/integrations';
import { deleteAllPricingWindows } from '@tests/support/pricing-windows';
import { createTestApp, setUpFirstUser } from '@tests/support/test-app';
import { deleteAllUpstreamData } from '@tests/support/upstream';

const reloads = vi.hoisted(() => ({ failuresLeft: 0 }));

vi.mock('@/snapshot/models/load-snapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/snapshot/models/load-snapshot')>();
  return {
    ...actual,
    loadSnapshot: async (...args: Parameters<typeof actual.loadSnapshot>) => {
      if (reloads.failuresLeft > 0) {
        reloads.failuresLeft -= 1;
        throw new Error('forced snapshot reload failure');
      }
      return actual.loadSnapshot(...args);
    },
  };
});

const PROPAGATION_LIMIT_MS = 1000;
const POLL_INTERVAL_MS = 50;
vi.hoisted(() => {
  process.env.SNAPSHOT_RELOAD_INTERVAL_MS = '200';
});

async function eventually(check: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + PROPAGATION_LIMIT_MS;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

describe('Snapshot refresh across backend instances (e2e)', () => {
  let dashboardInstance: NestNodeApplication;
  let inferenceInstance: NestNodeApplication;
  let db: Database;
  let cookie: string;

  beforeAll(async () => {
    ({ app: dashboardInstance, db } = await createTestApp());
    ({ app: inferenceInstance } = await createTestApp());
  });

  beforeEach(async () => {
    await deleteAllUpstreamData(dashboardInstance, inferenceInstance);
    await deleteAllPricingWindows(dashboardInstance);
    cookie = await setUpFirstUser(dashboardInstance, {
      email: 'ops@example.com',
      password: 'ops password',
    });
  });

  afterAll(async () => {
    await inferenceInstance.close();
    await dashboardInstance.close();
  });

  it('refuses a key revoked on the dashboard of another instance', async () => {
    const { key, id } = await insertApiKey(dashboardInstance, db);
    await eventually(async () => {
      await request(inferenceInstance.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);
    });

    await request(dashboardInstance.getHttpServer())
      .post(`/api/api-keys/${id}/revoke`)
      .set('Cookie', cookie)
      .expect(204);

    await eventually(async () => {
      await request(inferenceInstance.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${key}`)
        .expect(401);
    });
  });

  it('stops listing a Model disabled on the dashboard of another instance', async () => {
    const { modelId } = await insertOpenAiChatModel(dashboardInstance, db, {
      modelName: 'smart',
      baseUrl: 'http://upstream.invalid/v1',
    });
    const { key } = await insertApiKey(dashboardInstance, db);

    await request(dashboardInstance.getHttpServer())
      .patch(`/api/models/${modelId}`)
      .set('Cookie', cookie)
      .send({ isEnabled: false })
      .expect(200);

    await eventually(async () => {
      const response = await request(inferenceInstance.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);
      expect(response.body.data).toEqual([]);
    });
  });

  it('stops pricing at a Pricing Window disabled on the dashboard of another instance', async () => {
    await insertOpenAiChatModel(dashboardInstance, db, {
      modelName: 'smart',
      baseUrl: 'http://upstream.invalid/v1',
    });
    const [{ id: upstreamModelId }] = await db.select().from(upstreamModels);
    const window = await request(dashboardInstance.getHttpServer())
      .post('/api/pricing-windows')
      .set('Cookie', cookie)
      .send({
        name: 'Weekend',
        timeZone: 'Asia/Jakarta',
        ranges: [{ weekdays: [6, 7], start: '00:00', end: '24:00' }],
      })
      .expect(201);
    await request(dashboardInstance.getHttpServer())
      .put(`/api/upstream-models/${upstreamModelId}/pricing-windows`)
      .set('Cookie', cookie)
      .send([{ pricingWindowId: window.body.id, inputPrice: 0.5 }])
      .expect(200);
    const { secret } = await createIntegration(dashboardInstance, cookie);
    const inferenceControlPlane = httpControlPlaneClient(inferenceInstance);
    const listedWindowCount = async (): Promise<number | undefined> => {
      const listed = await inferenceControlPlane.listModels(secret);
      return listed.ok ? listed.body.models[0]?.pricingWindows.length : undefined;
    };
    await eventually(async () => {
      expect(await listedWindowCount()).toBe(1);
    });

    await request(dashboardInstance.getHttpServer())
      .patch(`/api/pricing-windows/${window.body.id}`)
      .set('Cookie', cookie)
      .send({ isEnabled: false })
      .expect(200);

    await eventually(async () => {
      expect(await listedWindowCount()).toBe(0);
    });
  });

  it('refuses a revoked key on another instance even when the publish was lost', async () => {
    const { key, id } = await insertApiKey(dashboardInstance, db);
    await eventually(async () => {
      await request(inferenceInstance.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);
    });
    const publish = vi
      .spyOn(dashboardInstance.get(RedisConnection).client, 'publish')
      .mockRejectedValue(new Error('Redis is down'));

    try {
      await request(dashboardInstance.getHttpServer())
        .post(`/api/api-keys/${id}/revoke`)
        .set('Cookie', cookie)
        .expect(204);
    } finally {
      publish.mockRestore();
    }

    await eventually(async () => {
      await request(inferenceInstance.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${key}`)
        .expect(401);
    });
  });

  it('retries a failed reload until the revoking instance refuses the key too', async () => {
    const { app: revokingInstance } = await createTestApp();
    revokingInstance.get(SchedulerRegistry).deleteInterval('snapshot-reload');
    try {
      const { key, id } = await insertApiKey(revokingInstance, db);
      await request(revokingInstance.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${key}`)
        .expect(200);

      reloads.failuresLeft = 1;
      await request(revokingInstance.getHttpServer())
        .post(`/api/api-keys/${id}/revoke`)
        .set('Cookie', cookie)
        .expect(204);

      await eventually(async () => {
        await request(revokingInstance.getHttpServer())
          .get('/v1/models')
          .set('Authorization', `Bearer ${key}`)
          .expect(401);
      });
    } finally {
      reloads.failuresLeft = 0;
      await revokingInstance.close();
    }
  });
});
