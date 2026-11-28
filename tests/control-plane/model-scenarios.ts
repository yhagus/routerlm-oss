import type { NestNodeApplication } from '@nestjs/platform-node';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { models, routes, upstreamModels } from '@/db/schemas';
import type { Database } from '@/db/schemas/relations';
import { SnapshotService } from '@/snapshot/providers/snapshot.service';
import type { ControlPlaneClient } from '@tests/support/control-plane-client';
import {
  addOpenAiChatRoute,
  insertDashScopeImageModel,
  insertOpenAiChatModel,
} from '@tests/support/inference';
import { createIntegration } from '@tests/support/integrations';
import { insertModelGroup } from '@tests/support/model-groups';
import { createTestApp, deleteAllUsers, setUpFirstUser } from '@tests/support/test-app';
import { truncateTables } from '@tests/support/truncate';
import type { ControlPlaneTransport } from './key-scenarios';

const ADA = { email: 'ada@example.com', password: "ada's password" };
const WINDOW_TIME_ZONE = 'Asia/Jakarta';
const WEEKEND = [{ weekdays: [6, 7], start: '00:00', end: '24:00' }];
const WEEKDAY_LUNCH = [{ weekdays: [1, 2, 3, 4, 5], start: '12:00', end: '13:00' }];
const WEEKDAY_NIGHT = [{ weekdays: [1, 2, 3, 4, 5], start: '01:00', end: '05:00' }];
const UNUSED_BASE_URL = 'http://127.0.0.1:1/v1';

export function describeModelScenarios(transport: ControlPlaneTransport): void {
  describe(`Control plane Models over ${transport.name} (e2e)`, () => {
    let app: NestNodeApplication;
    let db: Database;
    let client: ControlPlaneClient;
    let closeClient: () => Promise<void>;
    let adaCookie: string;

    beforeAll(async () => {
      ({ app, db } = await createTestApp());
      ({ client, close: closeClient } = await transport.connect(app));
    });

    beforeEach(async () => {
      await truncateTables(
        db,
        sql.raw('integrations, api_keys, models, model_groups, providers, pricing_windows'),
      );
      await deleteAllUsers(db);
      adaCookie = await setUpFirstUser(app, ADA);
    });

    afterAll(async () => {
      await closeClient();
      await app.close();
    });

    async function setTokenPrices(
      routeId: string,
      prices: { inputPrice: number; outputPrice: number; cacheReadPrice?: number },
    ): Promise<void> {
      const [route] = await db.select().from(routes).where(eq(routes.id, routeId));
      await db
        .update(upstreamModels)
        .set(prices)
        .where(eq(upstreamModels.id, route.upstreamModelId));
      await app.get(SnapshotService).changed();
    }

    it("lists each Model with its Kind, Capabilities and the first Route's prices, and nothing of what serves it", async () => {
      const chat = await insertOpenAiChatModel(app, db, {
        modelName: 'acme-large',
        baseUrl: UNUSED_BASE_URL,
        capabilities: ['vision', 'tools'],
      });
      await setTokenPrices(chat.routeId, { inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3 });
      const fallback = await addOpenAiChatRoute(app, db, chat.modelId, {
        baseUrl: UNUSED_BASE_URL,
        providerSlug: 'acme-fallback',
        priority: 1,
        capabilities: ['reasoning'],
      });
      await setTokenPrices(fallback.routeId, { inputPrice: 99, outputPrice: 99 });
      const image = await insertDashScopeImageModel(app, db, {
        modelName: 'acme-image',
        baseUrl: UNUSED_BASE_URL,
        pricePerImageBySize: { '1K': 0.04, '2K': 0.08 },
      });
      const { secret } = await createIntegration(app, adaCookie);

      const listed = await client.listModels(secret);

      expect(listed).toEqual({
        ok: true,
        body: {
          models: [
            {
              id: image.modelId,
              name: 'acme-image',
              kind: 'image',
              capabilities: [],
              pricePerImageBySize: { '1K': 0.04, '2K': 0.08 },
              pricingWindows: [],
            },
            {
              id: chat.modelId,
              name: 'acme-large',
              kind: 'chat',
              capabilities: ['vision', 'tools', 'reasoning'],
              inputPrice: 3,
              outputPrice: 15,
              cacheReadPrice: 0.3,
              pricingWindows: [],
            },
          ],
        },
      });
    });

    async function upstreamModelIdOf(routeId: string): Promise<string> {
      const [route] = await db.select().from(routes).where(eq(routes.id, routeId));
      return route.upstreamModelId;
    }

    async function createPricingWindow(
      name: string,
      ranges: object[],
      isEnabled = true,
    ): Promise<string> {
      const created = await request(app.getHttpServer())
        .post('/api/pricing-windows')
        .set('Cookie', adaCookie)
        .send({ name, timeZone: WINDOW_TIME_ZONE, ranges, isEnabled })
        .expect(201);
      return created.body.id;
    }

    async function attachPricingWindows(upstreamModelId: string, entries: object[]): Promise<void> {
      await request(app.getHttpServer())
        .put(`/api/upstream-models/${upstreamModelId}/pricing-windows`)
        .set('Cookie', adaCookie)
        .send(entries)
        .expect(200);
    }

    it("lists the first Route's enabled Pricing Windows by window name, with resolved prices and no name or id", async () => {
      const chat = await insertOpenAiChatModel(app, db, {
        modelName: 'acme-large',
        baseUrl: UNUSED_BASE_URL,
        capabilities: [],
      });
      await setTokenPrices(chat.routeId, { inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3 });
      const fallback = await addOpenAiChatRoute(app, db, chat.modelId, {
        baseUrl: UNUSED_BASE_URL,
        providerSlug: 'acme-fallback',
        priority: 1,
        capabilities: [],
      });
      const lunchId = await createPricingWindow('Lunch', WEEKDAY_LUNCH);
      const nightId = await createPricingWindow('Night', WEEKDAY_NIGHT, false);
      const weekendId = await createPricingWindow('Weekend', WEEKEND);
      await attachPricingWindows(await upstreamModelIdOf(chat.routeId), [
        { pricingWindowId: lunchId, inputPrice: 1 },
        { pricingWindowId: nightId, inputPrice: 0.1 },
        { pricingWindowId: weekendId, outputPrice: 5, cacheWritePrice: 0.6 },
      ]);
      await attachPricingWindows(await upstreamModelIdOf(fallback.routeId), [
        { pricingWindowId: nightId, inputPrice: 0.2 },
      ]);
      const { secret } = await createIntegration(app, adaCookie);

      const listed = await client.listModels(secret);

      expect(listed).toEqual({
        ok: true,
        body: {
          models: [
            {
              id: chat.modelId,
              name: 'acme-large',
              kind: 'chat',
              capabilities: [],
              inputPrice: 3,
              outputPrice: 15,
              cacheReadPrice: 0.3,
              pricingWindows: [
                {
                  timeZone: WINDOW_TIME_ZONE,
                  ranges: WEEKDAY_LUNCH,
                  inputPrice: 1,
                  outputPrice: 15,
                  cacheReadPrice: 0.3,
                },
                {
                  timeZone: WINDOW_TIME_ZONE,
                  ranges: WEEKEND,
                  inputPrice: 3,
                  outputPrice: 5,
                  cacheReadPrice: 0.3,
                  cacheWritePrice: 0.6,
                },
              ],
            },
          ],
        },
      });
    });

    it('lists Window Prices with their Validity Period as instants, leaving out ended ones and keeping upcoming ones', async () => {
      const chat = await insertOpenAiChatModel(app, db, {
        modelName: 'acme-large',
        baseUrl: UNUSED_BASE_URL,
        capabilities: [],
      });
      await setTokenPrices(chat.routeId, { inputPrice: 3, outputPrice: 15 });
      const weekendId = await createPricingWindow('Weekend', WEEKEND);
      await attachPricingWindows(await upstreamModelIdOf(chat.routeId), [
        {
          pricingWindowId: weekendId,
          inputPrice: 2,
          validFrom: '2020-01-01T00:00',
          validUntil: '2020-02-01T00:00',
        },
        {
          pricingWindowId: weekendId,
          inputPrice: 1,
          validFrom: '2020-02-01T00:00',
          validUntil: '2099-01-01T00:00',
        },
        { pricingWindowId: weekendId, inputPrice: 0.5, validFrom: '2099-01-01T00:00' },
      ]);
      const { secret } = await createIntegration(app, adaCookie);

      const listed = await client.listModels(secret);

      expect(listed.ok && listed.body.models[0].pricingWindows).toEqual([
        {
          timeZone: WINDOW_TIME_ZONE,
          ranges: WEEKEND,
          inputPrice: 1,
          outputPrice: 15,
          validFrom: '2020-01-31T17:00:00.000Z',
          validUntil: '2098-12-31T17:00:00.000Z',
        },
        {
          timeZone: WINDOW_TIME_ZONE,
          ranges: WEEKEND,
          inputPrice: 0.5,
          outputPrice: 15,
          validFrom: '2098-12-31T17:00:00.000Z',
        },
      ]);
    });

    it("lists only the enabled Models within the Integration's allowed Models", async () => {
      const sold = await insertOpenAiChatModel(app, db, {
        modelName: 'acme-large',
        baseUrl: UNUSED_BASE_URL,
      });
      const disabled = await insertOpenAiChatModel(app, db, {
        modelName: 'acme-retired',
        baseUrl: UNUSED_BASE_URL,
      });
      await db.update(models).set({ isEnabled: false }).where(eq(models.id, disabled.modelId));
      await app.get(SnapshotService).changed();
      await insertOpenAiChatModel(app, db, { modelName: 'acme-secret', baseUrl: UNUSED_BASE_URL });
      const { secret } = await createIntegration(app, adaCookie, {
        name: 'Acme SaaS',
        allowedModelIds: [sold.modelId, disabled.modelId],
      });

      const listed = await client.listModels(secret);

      expect(listed.ok && listed.body.models.map((model) => model.name)).toEqual(['acme-large']);
    });

    it("lists the Models in the Integration's allowed Model Groups alongside its allowed Models", async () => {
      const grouped = await insertOpenAiChatModel(app, db, {
        modelName: 'acme-fast',
        baseUrl: UNUSED_BASE_URL,
      });
      const sold = await insertOpenAiChatModel(app, db, {
        modelName: 'acme-large',
        baseUrl: UNUSED_BASE_URL,
      });
      await insertOpenAiChatModel(app, db, { modelName: 'acme-secret', baseUrl: UNUSED_BASE_URL });
      const fastGroupId = await insertModelGroup(app, db, 'fast', [grouped.modelId]);
      const { secret } = await createIntegration(app, adaCookie, {
        name: 'Acme SaaS',
        allowedModelIds: [sold.modelId],
        allowedModelGroupIds: [fastGroupId],
      });

      const listed = await client.listModels(secret);

      expect(listed.ok && listed.body.models.map((model) => model.name)).toEqual([
        'acme-fast',
        'acme-large',
      ]);
    });
  });
}
