import type { NestNodeApplication } from "@nestjs/platform-node";
import { eq, sql } from "drizzle-orm";
import { models, routes, upstreamModels } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { SnapshotService } from "@/snapshot/providers/snapshot.service.js";
import type { ControlPlaneClient } from "@tests/support/control-plane-client.js";
import {
  addOpenAiChatRoute,
  insertDashScopeImageModel,
  insertOpenAiChatModel,
} from "@tests/support/inference.js";
import { createIntegration } from "@tests/support/integrations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "@tests/support/test-app.js";
import type { ControlPlaneTransport } from "./key-scenarios.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
// The Models here are only listed, never called.
const UNUSED_BASE_URL = "http://127.0.0.1:1/v1";

/** The control plane's List Models scenarios. */
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
      await db.execute(sql`truncate table integrations, api_keys, models, providers cascade`);
      await deleteAllUsers(db);
      adaCookie = await setUpFirstUser(app, ADA);
    });

    afterAll(async () => {
      await closeClient();
      await app.close();
    });

    /** Sets the token prices of the Upstream Model behind a Route, then refreshes the snapshot. */
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
        modelName: "acme-large",
        baseUrl: UNUSED_BASE_URL,
        capabilities: ["vision", "tools"],
      });
      await setTokenPrices(chat.routeId, { inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3 });
      const fallback = await addOpenAiChatRoute(app, db, chat.modelId, {
        baseUrl: UNUSED_BASE_URL,
        providerSlug: "acme-fallback",
        priority: 1,
        capabilities: ["reasoning"],
      });
      await setTokenPrices(fallback.routeId, { inputPrice: 99, outputPrice: 99 });
      const image = await insertDashScopeImageModel(app, db, {
        modelName: "acme-image",
        baseUrl: UNUSED_BASE_URL,
        pricePerImageBySize: { "1K": 0.04, "2K": 0.08 },
      });
      const { secret } = await createIntegration(app, adaCookie);

      const listed = await client.listModels(secret);

      expect(listed).toEqual({
        ok: true,
        body: {
          models: [
            {
              id: image.modelId,
              name: "acme-image",
              kind: "image",
              capabilities: [],
              pricePerImageBySize: { "1K": 0.04, "2K": 0.08 },
            },
            {
              id: chat.modelId,
              name: "acme-large",
              kind: "chat",
              capabilities: ["vision", "tools", "reasoning"],
              inputPrice: 3,
              outputPrice: 15,
              cacheReadPrice: 0.3,
            },
          ],
        },
      });
    });

    it("lists only the enabled Models within the Integration's allowed Models", async () => {
      const sold = await insertOpenAiChatModel(app, db, {
        modelName: "acme-large",
        baseUrl: UNUSED_BASE_URL,
      });
      const disabled = await insertOpenAiChatModel(app, db, {
        modelName: "acme-retired",
        baseUrl: UNUSED_BASE_URL,
      });
      await db.update(models).set({ isEnabled: false }).where(eq(models.id, disabled.modelId));
      await app.get(SnapshotService).changed();
      await insertOpenAiChatModel(app, db, { modelName: "acme-secret", baseUrl: UNUSED_BASE_URL });
      const { secret } = await createIntegration(app, adaCookie, {
        name: "Acme SaaS",
        allowedModelIds: [sold.modelId, disabled.modelId],
      });

      const listed = await client.listModels(secret);

      expect(listed.ok && listed.body.models.map((model) => model.name)).toEqual(["acme-large"]);
    });
  });
}
