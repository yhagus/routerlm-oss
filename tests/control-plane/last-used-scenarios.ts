import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import request from "supertest";
import type { Database } from "@/db/schemas/relations.js";
import type { ControlPlaneClient } from "../support/control-plane-client.js";
import { createIntegration } from "../support/integrations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";
import type { ControlPlaneTransport } from "./key-scenarios.js";

const ADA = { email: "ada@example.com", password: "ada's password" };

/** When an Integration Secret was last used, as the dashboard shows it after control plane calls. */
export function describeLastUsedScenarios(transport: ControlPlaneTransport): void {
  describe(`Integration Secret last use over ${transport.name} (e2e)`, () => {
    let app: NestNodeApplication;
    let db: Database;
    let client: ControlPlaneClient;
    let closeClient: () => Promise<void>;
    let adaCookie: string;
    let acme: { id: string; secret: string };

    beforeAll(async () => {
      ({ app, db } = await createTestApp());
      ({ client, close: closeClient } = await transport.connect(app));
    });

    beforeEach(async () => {
      await db.execute(sql`truncate table integrations, api_keys cascade`);
      await deleteAllUsers(db);
      adaCookie = await setUpFirstUser(app, ADA);
      acme = await createIntegration(app, adaCookie, { name: "Acme SaaS" });
    });

    afterAll(async () => {
      await closeClient();
      await app.close();
    });

    async function lastUsedAt(): Promise<string | null> {
      const detail = await request(app.getHttpServer())
        .get(`/api/integrations/${acme.id}`)
        .set("Cookie", adaCookie)
        .expect(200);
      return detail.body.lastUsedAt;
    }

    it("records the first call, and not again for a call within the minute", async () => {
      await client.listModels(acme.secret);
      const afterFirstCall = await lastUsedAt();
      await client.listModels(acme.secret);
      const afterSecondCall = await lastUsedAt();

      expect(afterFirstCall).toEqual(expect.any(String));
      expect(afterSecondCall).toBe(afterFirstCall);
    });

    it("records no use for a disabled Integration's refused secret", async () => {
      await request(app.getHttpServer())
        .post(`/api/integrations/${acme.id}/disable`)
        .set("Cookie", adaCookie)
        .expect(204);

      await expect(client.listModels(acme.secret)).resolves.toMatchObject({ ok: false });

      expect(await lastUsedAt()).toBeNull();
    });
  });
}
