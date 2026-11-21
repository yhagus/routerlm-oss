import type { NestNodeApplication } from "@nestjs/platform-node";
import { sql } from "drizzle-orm";
import { usageLogs } from "@/db/schemas/index.js";
import type { Database } from "@/db/schemas/relations.js";
import { createApiKey } from "../support/api-keys.js";
import type { ControlPlaneClient } from "../support/control-plane-client.js";
import { createIntegration } from "../support/integrations.js";
import { createTestApp, deleteAllUsers, setUpFirstUser } from "../support/test-app.js";
import type { ControlPlaneTransport } from "./key-scenarios.js";

const ADA = { email: "ada@example.com", password: "ada's password" };
const RECEIVED_AT = new Date("2026-11-20T09:30:00.000Z");

/** Who a seeded Usage Log was made by: a Customer's key, or an operator's key. */
interface UsageLogCaller {
  apiKeyId: string;
  apiKeyName: string;
  integration?: { id: string; name: string; customerId: string };
}

/**
 * The control plane's usage pull scenarios. Usage Logs are inserted straight
 * in the database, as the worker writes them, so a test controls when each
 * one's transaction commits.
 */
export function describeUsageScenarios(transport: ControlPlaneTransport): void {
  describe(`Control plane usage pull over ${transport.name} (e2e)`, () => {
    let app: NestNodeApplication;
    let db: Database;
    let client: ControlPlaneClient;
    let closeClient: () => Promise<void>;
    let adaCookie: string;
    let acme: { id: string; secret: string };
    let acmeCaller: UsageLogCaller;

    beforeAll(async () => {
      ({ app, db } = await createTestApp());
      ({ client, close: closeClient } = await transport.connect(app));
    });

    beforeEach(async () => {
      await db.execute(sql`truncate table integrations, api_keys, usage_logs cascade`);
      await deleteAllUsers(db);
      adaCookie = await setUpFirstUser(app, ADA);
      acme = await createIntegration(app, adaCookie, { name: "Acme SaaS" });
      acmeCaller = await customerCaller(acme, "Acme SaaS", "cus_1");
    });

    afterAll(async () => {
      await closeClient();
      await app.close();
    });

    async function customerCaller(
      integration: { id: string; secret: string },
      integrationName: string,
      customerId: string,
    ): Promise<UsageLogCaller> {
      const created = await client.createKey(integration.secret, { customerId });
      if (!created.ok) throw new Error(`createKey failed with ${created.code}`);
      return {
        apiKeyId: created.body.apiKey.id,
        apiKeyName: created.body.apiKey.name,
        integration: { id: integration.id, name: integrationName, customerId },
      };
    }

    /** Pulls one page, failing the test if the call fails. */
    async function pull(query: { after?: string; pageSize?: number } = {}) {
      const page = await client.listUsageLogs(acme.secret, query);
      if (!page.ok) throw new Error(`listUsageLogs failed with ${page.code}`);
      return page.body;
    }

    it("returns a Customer's request with what the Integration bills by, and nothing of what served it", async () => {
      const [usageLog] = await db
        .insert(usageLogs)
        .values({
          ...usageLogOf(acmeCaller),
          modelName: "acme-large",
          routeId: crypto.randomUUID(),
          upstreamModelId: crypto.randomUUID(),
          upstreamModelName: "acme-large-2026",
          providerSlug: "acme",
          providerAccountId: crypto.randomUUID(),
          providerAccountName: "main",
          userAgent: "acme-sdk/1.0",
          clientIp: "203.0.113.7",
          isStreamed: true,
          inputTokens: 1200,
          outputTokens: 300,
          cacheReadTokens: 1000,
          reasoningTokens: 50,
          cost: 0.0042,
          timeToFirstTokenMs: 420,
          durationMs: 1800,
        })
        .returning({ id: usageLogs.id });

      const page = await pull();

      expect(page.usageLogs).toEqual([
        {
          id: usageLog.id,
          receivedAt: "2026-11-20T09:30:00.000Z",
          apiKeyId: acmeCaller.apiKeyId,
          apiKeyName: "cus_1",
          customerId: "cus_1",
          modelName: "acme-large",
          kind: "chat",
          clientProtocol: "openai-chat",
          streamed: true,
          httpStatus: 200,
          inputTokens: 1200,
          outputTokens: 300,
          cacheReadTokens: 1000,
          reasoningTokens: 50,
          cost: 0.0042,
          timeToFirstTokenMs: 420,
          durationMs: 1800,
          cancelled: false,
          incomplete: false,
        },
      ]);
    });

    it("returns a refused request's error code and Error Origin", async () => {
      await db.insert(usageLogs).values({
        ...usageLogOf(acmeCaller),
        httpStatus: 403,
        errorCode: "model_not_allowed",
        errorOrigin: "client",
      });

      const page = await pull();

      expect(page.usageLogs).toEqual([
        expect.objectContaining({
          httpStatus: 403,
          errorCode: "model_not_allowed",
          errorOrigin: "client",
        }),
      ]);
    });

    it("pages oldest first after the cursor, and answers the same cursor when nothing is new", async () => {
      const [first, second, third] = await db
        .insert(usageLogs)
        .values([usageLogOf(acmeCaller), usageLogOf(acmeCaller), usageLogOf(acmeCaller)])
        .returning({ id: usageLogs.id });

      const firstPage = await pull({ pageSize: 2 });
      const secondPage = await pull({ after: firstPage.nextCursor, pageSize: 2 });
      const emptyPage = await pull({ after: secondPage.nextCursor, pageSize: 2 });

      expect(firstPage.usageLogs.map((usageLog) => usageLog.id)).toEqual([first.id, second.id]);
      expect(secondPage.usageLogs.map((usageLog) => usageLog.id)).toEqual([third.id]);
      expect(emptyPage).toEqual({ usageLogs: [], nextCursor: secondPage.nextCursor });
    });

    it("never skips a Usage Log whose transaction commits after one with a higher sequence", async () => {
      const lateRow = startUsageLogTransaction(db, usageLogOf(acmeCaller));
      const lateRowId = await lateRow.inserted;
      const [earlyRow] = await db
        .insert(usageLogs)
        .values(usageLogOf(acmeCaller))
        .returning({ id: usageLogs.id });

      const whileLateRowRuns = await pull();
      await lateRow.commit();
      const afterItCommits = await pull({ after: whileLateRowRuns.nextCursor });

      expect(whileLateRowRuns.usageLogs).toEqual([]);
      expect(afterItCommits.usageLogs.map((usageLog) => usageLog.id)).toEqual([
        lateRowId,
        earlyRow.id,
      ]);
    });

    it("never returns another Integration's or an operator key's Usage Logs", async () => {
      const globex = await createIntegration(app, adaCookie, { name: "Globex" });
      const globexCaller = await customerCaller(globex, "Globex", "cus_1");
      const operatorKey = await createApiKey(app, adaCookie);
      const [acmeRow] = await db
        .insert(usageLogs)
        .values([
          usageLogOf(acmeCaller),
          usageLogOf(globexCaller),
          usageLogOf({ apiKeyId: operatorKey.id, apiKeyName: "CI" }),
        ])
        .returning({ id: usageLogs.id });

      const page = await pull();

      expect(page.usageLogs.map((usageLog) => usageLog.id)).toEqual([acmeRow.id]);
    });

    it("refuses a cursor it did not hand out", async () => {
      await expect(client.listUsageLogs(acme.secret, { after: "not-a-cursor" })).resolves.toEqual({
        ok: false,
        code: "INVALID_ARGUMENT",
      });
    });
  });
}

/**
 * Inserts a Usage Log in a transaction left open until `commit` is called, as
 * a worker whose transaction commits late. `inserted` resolves to its id.
 */
function startUsageLogTransaction(
  db: Database,
  usageLog: typeof usageLogs.$inferInsert,
): { inserted: Promise<string>; commit: () => Promise<void> } {
  let resolveInserted: (id: string) => void = () => {};
  const inserted = new Promise<string>((resolve) => {
    resolveInserted = resolve;
  });
  let allowCommit: () => void = () => {};
  const commitAllowed = new Promise<void>((resolve) => {
    allowCommit = resolve;
  });
  const transaction = db.transaction(async (tx) => {
    const [row] = await tx.insert(usageLogs).values(usageLog).returning({ id: usageLogs.id });
    resolveInserted(row.id);
    await commitAllowed;
  });
  return {
    inserted,
    commit: () => {
      allowCommit();
      return transaction;
    },
  };
}

/** A successful chat request by `caller`, as the worker records it. */
function usageLogOf(caller: UsageLogCaller): typeof usageLogs.$inferInsert {
  return {
    createdAt: RECEIVED_AT,
    apiKeyId: caller.apiKeyId,
    apiKeyName: caller.apiKeyName,
    integrationId: caller.integration?.id,
    integrationName: caller.integration?.name,
    customerId: caller.integration?.customerId,
    modelName: "acme-large",
    clientProtocol: "openai-chat",
    isStreamed: false,
    httpStatus: 200,
    requestBytes: 100,
    responseBytes: 200,
    durationMs: 900,
    attemptCount: 1,
  };
}
